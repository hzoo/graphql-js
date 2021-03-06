/* @flow */
/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import { Kind } from '../language';
import type { Field } from '../language/ast';
import {
  isCompositeType,
  getNullableType,
  getUnmodifiedType,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLInputObjectType,
  GraphQLList,
} from '../type/definition';
import type {
  GraphQLType,
  GraphQLInputType,
  GraphQLOutputType,
  GraphQLCompositeType,
  GraphQLFieldDefinition,
} from '../type/definition';
import {
  SchemaMetaFieldDef,
  TypeMetaFieldDef,
  TypeNameMetaFieldDef
} from '../type/introspection';
import type { GraphQLSchema } from '../type/schema';
import type { Node } from '../language/ast';
import typeFromAST from '../utils/typeFromAST';
import find from './find';


/**
 * FieldInfo is a utility class which, given a GraphQL schema, can keep track
 * of the current field and type definitions at any point in a GraphQL document
 * AST during a recursive descent by calling `enter(node)` and `leave(node)`.
 */
export default class TypeInfo {
  _schema: GraphQLSchema;
  _typeStack: Array<?GraphQLOutputType>;
  _parentTypeStack: Array<?GraphQLCompositeType>;
  _inputTypeStack: Array<?GraphQLInputType>;
  _fieldDefStack: Array<?GraphQLFieldDefinition>;

  constructor(schema: GraphQLSchema) {
    this._schema = schema;
    this._typeStack = [];
    this._parentTypeStack = [];
    this._inputTypeStack = [];
    this._fieldDefStack = [];
  }

  getType(): ?GraphQLOutputType {
    if (this._typeStack.length > 0) {
      return this._typeStack[this._typeStack.length - 1];
    }
  }

  getParentType(): ?GraphQLCompositeType {
    if (this._parentTypeStack.length > 0) {
      return this._parentTypeStack[this._parentTypeStack.length - 1];
    }
  }

  getInputType(): ?GraphQLInputType {
    if (this._inputTypeStack.length > 0) {
      return this._inputTypeStack[this._inputTypeStack.length - 1];
    }
  }

  getFieldDef(): ?GraphQLFieldDefinition {
    if (this._fieldDefStack.length > 0) {
      return this._fieldDefStack[this._fieldDefStack.length - 1];
    }
  }

  // Flow does not yet handle this case.
  enter(node: any/*Node*/) {
    var schema = this._schema;
    var type;
    switch (node.kind) {
      case Kind.SELECTION_SET:
        var compositeType: ?GraphQLCompositeType;
        var rawType = getUnmodifiedType(this.getType());
        if (isCompositeType(rawType)) {
          // isCompositeType is a type refining predicate, so this is safe.
          compositeType = ((rawType: any): GraphQLCompositeType);
        }
        this._parentTypeStack.push(compositeType);
        break;
      case Kind.FIELD:
        var parentType = this.getParentType();
        var fieldDef;
        if (parentType) {
          fieldDef = getFieldDef(schema, parentType, node);
        }
        this._fieldDefStack.push(fieldDef);
        this._typeStack.push(fieldDef && fieldDef.type);
        break;
      case Kind.OPERATION_DEFINITION:
        if (node.operation === 'query') {
          type = schema.getQueryType();
        } else if (node.operation === 'mutation') {
          type = schema.getMutationType();
        }
        this._typeStack.push(type);
        break;
      case Kind.INLINE_FRAGMENT:
      case Kind.FRAGMENT_DEFINITION:
        type = schema.getType(node.typeCondition.value);
        this._typeStack.push(type);
        break;
      case Kind.VARIABLE_DEFINITION:
        this._inputTypeStack.push(typeFromAST(schema, node.type));
        break;
      case Kind.ARGUMENT:
        var field = this.getFieldDef();
        var argType;
        if (field) {
          var argDef = find(field.args, arg => arg.name === node.name.value);
          if (argDef) {
            argType = argDef.type;
          }
        }
        this._inputTypeStack.push(argType);
        break;
      case Kind.DIRECTIVE:
        var directive = schema.getDirective(node.name.value);
        this._inputTypeStack.push(directive ? directive.type : undefined);
        break;
      case Kind.ARRAY:
        var arrayType = getNullableType(this.getInputType());
        this._inputTypeStack.push(
          arrayType instanceof GraphQLList ? arrayType.ofType : undefined
        );
        break;
      case Kind.OBJECT_FIELD:
        var objectType = getUnmodifiedType(this.getInputType());
        var fieldType;
        if (objectType instanceof GraphQLInputObjectType) {
          var inputField = objectType.getFields()[node.name.value];
          fieldType = inputField ? inputField.type : undefined;
        }
        this._inputTypeStack.push(fieldType);
        break;
    }
  }

  leave(node: Node) {
    switch (node.kind) {
      case Kind.SELECTION_SET:
        this._parentTypeStack.pop();
        break;
      case Kind.FIELD:
        this._fieldDefStack.pop();
        this._typeStack.pop();
        break;
      case Kind.OPERATION_DEFINITION:
      case Kind.INLINE_FRAGMENT:
      case Kind.FRAGMENT_DEFINITION:
        this._typeStack.pop();
        break;
      case Kind.VARIABLE_DEFINITION:
      case Kind.ARGUMENT:
      case Kind.DIRECTIVE:
      case Kind.ARRAY:
      case Kind.OBJECT_FIELD:
        this._inputTypeStack.pop();
        break;
    }
  }
}

/**
 * Not exactly the same as the executor's definition of getFieldDef, in this
 * statically evaluated environment we do not always have an Object type,
 * and need to handle Interface and Union types.
 */
function getFieldDef(
  schema: GraphQLSchema,
  parentType: GraphQLType,
  fieldAST: Field
): ?GraphQLFieldDefinition {
  var name = fieldAST.name.value;
  if (name === SchemaMetaFieldDef.name &&
      schema.getQueryType() === parentType) {
    return SchemaMetaFieldDef;
  }
  if (name === TypeMetaFieldDef.name &&
      schema.getQueryType() === parentType) {
    return TypeMetaFieldDef;
  }
  if (name === TypeNameMetaFieldDef.name &&
      (parentType instanceof GraphQLObjectType ||
       parentType instanceof GraphQLInterfaceType ||
       parentType instanceof GraphQLUnionType)
  ) {
    return TypeNameMetaFieldDef;
  }
  if (parentType instanceof GraphQLObjectType ||
      parentType instanceof GraphQLInterfaceType) {
    return parentType.getFields()[name];
  }
}
