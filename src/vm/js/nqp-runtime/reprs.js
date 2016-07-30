'use strict';
var sixmodel = require('./sixmodel.js');
var Hash = require('./hash.js');
var NQPInt = require('./nqp-int.js');
var NQPException = require('./nqp-exception.js');
var NQPArray = require('./array.js');

var reprs = {};
var reprById = [];

function basicTypeObjectFor(HOW) {
  var st = new sixmodel.STable(this, HOW);
  this._STable = st;

  var obj = st.createTypeObject();
  this._STable.WHAT = obj;

  return obj;
}

function basicAllocate(STable) {
  return new STable.objConstructor();
}

function noopCompose(obj, reprInfo) {
}


function basicConstructor(STable) {
  var objConstructor = function() {};
  objConstructor.prototype._STable = STable;
  return objConstructor;
}

function slotToAttr(slot) {
  return 'attr$' + slot;
}


class P6opaque {
    
  constructor () { 
    this.autoVivValues = [];
    this.template = {}
    this.flattenedStables = [];
    this.deserialized = false;
    this.nameToIndexMapping = [];
    this.mi = false;
  }


  allocate (STable) {
    var obj = new STable.objConstructor();
    Object.assign(obj, this.template);
    return obj;
  }
  

  precalculate () {
    var autovived = {};

    var self = this;
    self.nameToIndexMapping
      .map((mapping) => mapping.slots)
      .map((slot) => {
        if(self.autoVivValues[slot]) {
          if (!self.autoVivValues[slot].typeObject_) {
            console.warn('We currently only implement autoviv with type object values');
          }
          /* TODO autoviving things that aren't typeobjects */
          /* TODO we need to store attributes better */
          autovived[slotToAttr(slot)] = self.autoVivValues[slot];
        } else if (self.flattenedStables[slot]) {
          if (self.flattenedStables[slot].REPR.flattenedDefault !== undefined) {
            autovived[slotToAttr(slot)] = self.flattenedStables[slot].REPR.flattenedDefault;
          }
        }
      });

    self.autovived = autovived;

    /* TODO think about attribute types */
    self.nameToIndexMapping
      .map((mapping) => mapping.slots)
      .map((slot) => {
        this.template[slotToAttr(slot)] = (this.autovived) ? this.autovived[slotToAttr(slot)] : null;
      });

  }
  
  deserializeReprData (cursor, STable) {
    this.deserialized = true;
    var numAttributes = cursor.varint();
    for (var i = 0; i < numAttributes; i++) {
      this.flattenedStables.push((cursor.varint() != 0) ? cursor.locateThing('rootStables') : null);
    }
    this.mi = cursor.varint();
    var hasAutoVivValues = cursor.varint();
    if (hasAutoVivValues != false) {
      for (var i = 0; i < numAttributes; i++) {
        this.autoVivValues.push(cursor.variant());
      }
    }

    this.unboxIntSlot = cursor.varint();
    this.unboxNumSlot = cursor.varint();
    this.unboxStrSlot = cursor.varint();
    var hasUnboxSlots = cursor.varint();

    if (hasUnboxSlots != false) {
      this.unboxSlots = [];
      for (var i = 0; i < numAttributes; i++) {
        var reprId = cursor.varint();
        var slot = cursor.varint();
        if (reprId != 0) {
          this.unboxSlots.push({slot: slot, reprId: reprId});
        }
      }
    }

    var numClasses = cursor.varint();
    var slots = [];

    for (var i = 0; i < numClasses; i++) {
      this.nameToIndexMapping[i] = {slots: [], names: [], classKey: cursor.variant()};

      var numAttrs = cursor.varint();

      for (var j = 0; j < numAttrs; j++) {
        var name = cursor.str();
        var slot = cursor.varint();

        this.nameToIndexMapping[i].names[j] = name;
        this.nameToIndexMapping[i].slots[j] = slot;

        slots[slot] = name;
      }
    }

    this.precalculate();

    this.positionalDelegateSlot = cursor.varint();
    this.associativeDelegateSlot = cursor.varint();

    if (this.positionalDelegateSlot != -1) {
      STable.setPositionalDelegate(slotToAttr(this.positionalDelegateSlot));
    }
    if (this.associativeDelegateSlot != -1) {
      STable.setAssociativeDelegate(slotToAttr(this.associativeDelegateSlot));
    }

    if (this.unboxSlots) {
      for (var i = 0; i < this.unboxSlots.length; i++) {
        var slot = this.unboxSlots[i].slot;
        (new reprById[this.unboxSlots[i].reprId]).generateBoxingMethods(STable, slotToAttr(slot), this.flattenedStables[slot]);
      }
    }

    /* TODO make auto viv values work */
  }


  hintfor (classHandle, attrName) {
    for (var i = 0; i < this.nameToIndexMapping.length; i++) {
      if (this.nameToIndexMapping[i].classKey === classHandle) {
        for (var j = 0; j < this.nameToIndexMapping[i].slots.length; j++) {
          if (this.nameToIndexMapping[i].names[j] === attrName) {
            return this.nameToIndexMapping[i].slots[j];
          }
        }
      }
    }
    return -1;
  }


  getAttr (classHandle, attrName) {
    var hint = this.hintfor(classHandle, attrName);
    if (hint == -1) {
      throw "Can't find: " + attrName;
    } else {
      return slotToAttr(hint);
    }
  }


  serializeReprData (st, cursor) {
    var numAttrs = st.REPR.flattenedStables.length;
    cursor.varint(numAttrs);

    st.REPR.flattenedStables
      .map((state) => {
        if(state === null) {
          cursor.varint(0);
        } else {
          cursor.varint(1);
          cursor.STableRef(state);
        }
      });

    cursor.varint(st.REPR.mi ? 1 : 0);


    if (st.REPR.autoVivValues) {
      cursor.varint(1);
      for (var i = 0; i < numAttrs; i++) {
        cursor.ref(st.REPR.autoVivValues[i]);
      }
    } else {
      cursor.varint(0);
    }


    cursor.varint(st.REPR.unboxIntSlot);
    cursor.varint(st.REPR.unboxNumSlot);
    cursor.varint(st.REPR.unboxStrSlot);

    if (this.unboxSlots) {
      cursor.varint(1);
      for (var i = 0; i < numAttrs; i++) {
        if (this.unboxSlots[i]) {
          cursor.varint(this.unboxSlots[i].reprId);
          cursor.varint(this.unboxSlots[i].slot);
        } else {
          cursor.varint(0);
          cursor.varint(0);
        }
      }
    } else {
      cursor.varint(0);
    }


    cursor.varint(this.nameToIndexMapping.length);
    for (var i = 0; i < this.nameToIndexMapping.length; i++) {
      cursor.ref(this.nameToIndexMapping[i].classKey);

      var numAttrs = this.nameToIndexMapping[i].names.length;

      cursor.varint(numAttrs);

      for (var j = 0; j < numAttrs; j++) {
        cursor.str(this.nameToIndexMapping[i].names[j]);
        cursor.varint(this.nameToIndexMapping[i].slots[j]);
      }
    }

    cursor.varint(this.positionalDelegateSlot);
    cursor.varint(this.associativeDelegateSlot);
  }


  deserializeFinish (obj, data) {
    var attrs = [];

    for (var i = 0; i < this.flattenedStables.length; i++) {
      if (this.flattenedStables[i]) {
        var STable = this.flattenedStables[i];
        var flattenedObject = STable.REPR.allocate(STable);
        STable.REPR.deserializeFinish(flattenedObject, data);

        attrs.push(flattenedObject);
      } else {
        attrs.push(data.variant());
      }
    }

    for (var i in this.nameToIndexMapping) {
      for (var j in this.nameToIndexMapping[i].slots) {
        var slot = this.nameToIndexMapping[i].slots[j];
        obj[slotToAttr(slot)] = attrs[slot];
      }
    }
  }


  serialize (cursor, obj) {
    var flattened = obj._STable.REPR.flattenedStables;
    var nqp = require('nqp-runtime');
    if (!flattened) {
      throw 'Representation must be composed before it can be serialized';
    }

    for (var i = 0; i < flattened.length; i++) {
      var value = obj[slotToAttr(i)];
      if (flattened[i] == null || !flattened[i]) {
        // TODO - think about what happens when we get an undefined value here
        cursor.ref(value);
      }
      else {
        // HACK different kinds of numbers etc.
        var wrapped = typeof value == 'object' ? value : {value: value}; // HACK - think if that's a correct way of serializing a native attribute
        this.flattenedStables[i].REPR.serialize(cursor, wrapped);
      }
    }
  }


  changeType (obj, newType) {
    // TODO some sanity checks for the new mro being a subset and newType being also a P6opaque
    // HACK usage of __proto__ which is not fully portable and might interfere with the optimizer
    Object.setPrototypeOf(obj, newType._STable.objConstructor.prototype);
  }


  compose (STable, reprInfoHash) {
    // TODO
    var self = this;
    /* Get attribute part of the protocol from the hash. */
    var reprInfo = reprInfoHash.content.get('attribute').array;

    /* Go through MRO and find all classes with attributes and build up
     * mapping info hashes. Note, reverse order so indexes will match
     * those in parent types. */

    this.unboxIntSlot = -1;
    this.unboxNumSlot = -1;
    this.unboxStrSlot = -1;

    this.positionalDelegateSlot = -1;
    this.associativeDelegateSlot = -1;

    var curAttr = 0;
    /*
    List<SixModelObject> autoVivs = new ArrayList<SixModelObject>();
    List<AttrInfo> attrInfoList = new ArrayList<AttrInfo>();
    long mroLength = reprInfo.elems(tc);
    */
    var mi = false;


    reprInfo
      .reverse()
      .map((info) => {
        var entry = info.array;
        var type = entry[0];
        var attrs = entry[1].array;
        var parents = entry[2].array;
      });

    for (var i = reprInfo.length - 1; i >= 0; i--) {
      var entry = reprInfo[i].array;
      var type = entry[0];
      var attrs = entry[1].array;
      var parents = entry[2].array;

      /* If it has any attributes, give them each indexes and put them
         * in the list to add to the layout. */
      var names = [];
      var slots = [];

      attrs
        .map((attr) => attr.content)
        .map((attr, idx) => {
          var attrType = attr.get('type'); 
          if (attr.get('box_target')) {
            var REPR = attrType._STable.REPR;
            if (!self.unboxSlots) self.unboxSlots = [];
            self.unboxSlots.push({slot: idx, reprId: REPR.ID});
            REPR.generateBoxingMethods(STable, slotToAttr(idx), attrType._STable);
          }
 
          slots.push(idx);
          names.push(attr.get('name'));

          if (attr.get('box_target') && attrType._STable.REPR.flattenSTable) {
            self.flattenedStables.push(attrType._STable);
          } else {
            self.flattenedStables.push(null);
          }
 
          if (attr.get('positional_delegate')) {
            self.positionalDelegateSlot = idx;
            self._STable.setPositionalDelegate(slotToAttr(self.positionalDelegateSlot));
          }

          if (attr.get('associative_delegate')) {
            self.associativeDelegateSlot = idx;
            self._STable.setAssociativeDelegate(slotToAttr(self.associativeDelegateSlot));
          }

          if (attr.get('auto_viv_container')) {
            self.autoVivValues[idx] = attr.get('auto_viv_container');
          }

        });

      self.nameToIndexMapping.push({classKey: type, slots: slots, names: names});

      /* Multiple parents means it's multiple inheritance. */
      if (parents.length > 1) {
        mi = true;
      }
    }

    this.mi = mi ? true : false;

    this.precalculate();
  }

  setup_STable (STable) {
    var repr = this;
    STable.addInternalMethod('$$bindattr', function(classHandle, attrName, value) {
      return this[repr.getAttr(classHandle, attrName)] = value;
    });

    STable.addInternalMethod('$$getattr', function(classHandle, attrName) {
      return this[repr.getAttr(classHandle, attrName)];
    });
  }

}

P6opaque.prototype.createObjConstructor = basicConstructor;
P6opaque.prototype.typeObjectFor = basicTypeObjectFor;


reprs.P6opaque = P6opaque;


class KnowHOWREPR {
  constructor() {
  }

  deserialializeFinish (obj, data) {
    obj.__name = data.str();
    obj.__attributes = data.variant();
    obj.__methods = data.variant()
  }

  serialize (data, obj) {
    data.str(obj.__name);
    data.ref(obj.__attributes);
    data.ref(obj.__methods);
  };
}

KnowHOWREPR.prototype.createObjConstructor = basicConstructor;
KnowHOWREPR.prototype.typeObjectFor = basicTypeObjectFor;

KnowHOWREPR.prototype.allocate = function(STable) {
  var obj = new STable.objConstructor();
  obj.__methods = new Hash();
  obj.__attributes = new NQPArray([]);
  obj.__name = '<anon>';
  return obj;
};


reprs.KnowHOWREPR = KnowHOWREPR;

class KnowHOWAttribute {
  constructor () {}
  
  deserializeFinish (obj, data) {
    obj.__name = data.str();
  };

  serialize (data, obj) {
    data.str(obj.__name);
  };

}

KnowHOWAttribute.prototype.createObjConstructor = basicConstructor;

KnowHOWAttribute.prototype.typeObjectFor = basicTypeObjectFor;
KnowHOWAttribute.prototype.allocate = basicAllocate;
reprs.KnowHOWAttribute = KnowHOWAttribute;

class Uninstantiable {
  constructor () {}
}
Uninstantiable.prototype.createObjConstructor = basicConstructor;
Uninstantiable.prototype.typeObjectFor = basicTypeObjectFor;
reprs.Uninstantiable = Uninstantiable;

/* Stubs */
reprs.P6int = class P6int {
  constructor () {
    this.flattenedDefault = false;
    this.boxedPrimitive = true;
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
  }

  setup_STable (STable) {
    STable.addInternalMethod('$$setInt', function(value) {
      this.value = value;
    });
    STable.addInternalMethod('$$getInt', function() {
      return this.value;
    });
  };

  compose (STable, reprInfoHash) {
    var integer = reprInfoHash.content.get('integer');
    if (integer) {
      var bits = integer.content.get('bits');
      if (bits instanceof NQPInt) {
        this.bits = bits.value;
      } else {
        throw 'bits to P6int.compose must be a native int';
      }
    }
  }

  // TODO integers bigger than 32bit
  deserializeFinish (obj, data) { obj.value = data.varint(); }

  // TODO integers bigger than 32bit
  serialize (data, obj) { data.varint(obj.value) };

  generateBoxingMethods (STable, name) {
    STable.addInternalMethod('$$setInt', function(value) {
      this[name] = value;
    });

    STable.addInternalMethod('$$getInt', function() {
      return this[name];
    });
  };
}

reprs.P6num = class P6num {
  constructor () {
  
    this.boxedPrimitive = 2;
    this.allocate = basicAllocate;
    this.basicConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;

    // TODO:  handle float/bits stuff
    this.compose = noopCompose;

  }

  createObjConstructor (STable) {
    var c = this.basicConstructor(STable);

    STable.objConstructor = c; // HACK it's set again later, we set it for addInternalMethod

    STable.addInternalMethod('$$setNum', function(value) {
      this.value = value;
    });
    STable.addInternalMethod('$$getNum', function() {
      return this.value;
    });
    return c;
  }

  serialize (data, obj) { data.double(obj.value) };

  deserializeFinish (obj, data) { obj.value = data.double() };

  generateBoxingMethods (STable, name) {
    STable.addInternalMethod('$$setNum', function(value) {
      this[name] = value;
    });

    STable.addInternalMethod('$$getNum', function() {
      return this[name];
    });
  }

}


reprs.P6str = class P6str {
  constructor () {
    this.boxedPrimitive = 3;
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
    this.basicConstructor = basicConstructor;
    this.compose = noopCompose;
  }

  createObjConstructor (STable) {
    var c = this.basicConstructor(STable);

    STable.objConstructor = c; // HACK it's set again later, we set it for addInternalMethod

    STable.addInternalMethod('$$setStr', function(value) {
      this.value = value;
    });
    STable.addInternalMethod('$$getStr', function() {
      return this.value;
    });
    return c;
  }

  serialize (data, obj) { data.str(obj.value) };

  deserializeFinish (obj, data) { obj.value = data.str() };
  
  generateBoxingMethods (STable, name) {
    STable.addInternalMethod('$$setStr', function(value) {
      this[name] = value;
    });

    STable.addInternalMethod('$$getStr', function() {
      return this[name];
    });
  };

}




reprs.NFA = class NFA {
  constructor() {
  
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
    this.compose = noopCompose;
  }

  // STUB
  deserializeFinish (obj, data) { };
}


reprs.VMArray = class VMArray {
  constructor () {
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
  }
 
  // STUB
  deserializeFinish (obj, data) { console.log('deserializing VMArray') }
  
  deserializeReprData (cursor) {
    this.type = cursor.variant();
    /* TODO - type */
  }

  serializeReprData (st, cursor) {
    cursor.ref(this.type);
  }
  
  deserializeArray (obj, data) {
    if (this.type !== null) {
      console.log('NYI: VMArrays of a type different then null');
    }
    var size = data.varint();
    for (var i = 0; i < size; i++) {
      obj.array[i] = data.variant();
    }
  }
  // HACK

  compose (STable, reprInfoHash) {
    if (reprInfoHash.content.get('array')) {
      this.type = reprInfoHash.content.get('array').content.get('type');
    }
  }

}


reprs.VMIter = class VMIter {
  constructor () {
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
  }

  // STUB
  deserializeFinish (obj, data) { console.log('deserializing VMIter'); }
}


var bignum = require('bignum');

function makeBI(STable, num) {
  var instance = STable.REPR.allocate(STable);
  instance.$$setBignum(num);
  return instance;
}

function getBI(obj) {
  return obj.$$getBignum();
}

reprs.P6bigint = class P6bigint {
  constructor () {
    /* HACK - we should just do flattening properly instead of a weird flag */
    this.flattenSTable = true;
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
    this.compose = noopCompose;
  }

  setup_STable (STable) {
    STable.addInternalMethod('$$setInt', function(value) {
      this.value = bignum(value);
    });

    STable.addInternalMethod('$$getInt', function() {
      return this.value.toNumber() | 0;
    });

    STable.addInternalMethod('$$setBignum', function(value) {
      this.value = value;
    });

    STable.addInternalMethod('$$getBignum', function() {
      return this.value;
    });
  }

  deserializeFinish (obj, data) {
    if (data.varint() == 1) { /* Is it small int? */
      obj.value = bignum(data.varint());
    } else {
      obj.value = bignum(data.str());
    }
  }

  serialize (cursor, obj) {
    var isSmall = 0; /* TODO - check */

    cursor.varint(isSmall);
    if (isSmall) {
      cursor.varint(obj.value.toNumber());
    } else {
      cursor.str(obj.value.toString());
    }
  }

  generateBoxingMethods (STable, name, attrSTable) {
    STable.addInternalMethod('$$setInt', function(value) {
      this[name] = makeBI(attrSTable, bignum(value));
    });

    STable.addInternalMethod('$$getInt', function() {
      return getBI(this[name]).toNumber();
    });

    STable.addInternalMethod('$$getBignum', function() {
      return getBI(this[name]);
    });

    STable.addInternalMethod('$$setBignum', function(num) {
      this[name] = makeBI(attrSTable, num);
    });
  }
}









/* Stubs */

reprs.NativeCall = class NativeCall {
  constructor() {
    this.createObjConstructor = basicConstructor;
    this.allocate = basicAllocate;
    this.typeObjectFor = basicTypeObjectFor;
    this.compose = noopCompose;
  }
}


reprs.CPointer = class CPointer {
  constructor() {
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.compose = noopCompose;
  }
}

reprs.ReentrantMutex = class ReentrantMutex {
  constructor() {
    this.createObjConstructor = basicConstructor;
    this.allocate = basicAllocate;
    this.typeObjectFor = basicTypeObjectFor;
  }
}

reprs.ConditionVariable = class ConditionVariable {
  constructor() {
    this.createObjConstructor = basicConstructor;
  }
}


reprs.MultiDimArray = class MultiDimArray {
  constructor() {
    this.typeObjectFor = basicTypeObjectFor;
    this.allocate = basicAllocate;
    this.createObjConstructor = basicConstructor;
  }

  compose (STable, reprInfoHash) {
    var array = reprInfoHash.content.get('array');
    var dimensions = array.content.get('dimensions');

    var type = reprInfoHash.content.get('array').content.get('type');

    if (type) {
      STable.primType = type._STable.REPR.boxedPrimitive;
    } else {
      STable.primType = 0;
    }

    STable.type = type || null;

    if (dimensions instanceof NQPInt) {
      dimensions = dimensions.value;
      if (dimensions === 0) {
        throw new NQPException('MultiDimArray REPR must be composed with at least 1 dimension');
      }

    } else {
      throw 'dimensions to MultiDimArray.compose must be a native int';
    }

    //  console.log('dimensions', dimensions);
    STable.dimensions = dimensions;
  }

  setup_STable (STable) {
    STable.addInternalMethod('$$numdimensions', function(value) {
      if (this.typeObject_) {
        throw new NQPException('Cannot get number of dimensions of a type object');
      }
      return STable.dimensions;
    });

    STable.addInternalMethod('$$clone', function() {
      var clone = new this._STable.objConstructor();
      clone.storage = this.storage.slice();
      clone.dimensions = this.dimensions;
      return clone;
    });

    STable.addInternalMethod('$$dimensions', function() {
      if (this.typeObject_) {
        throw new NQPException('Cannot get dimensions of a type object');
      }
      return new NQPArray(this.dimensions);
    });

    STable.addInternalMethod('$$setdimensions', function(value) {
      if (value.array.length != STable.dimensions) {
        throw new NQPException('Array type of ' + STable.dimensions + ' dimensions cannot be intialized with ' + value.length + ' dimensions');
      } else if (this.dimensions) {
        throw new NQPException('Can only set dimensions once');
      }
      this.storage = [];
      return (this.dimensions = value.array);
    });

    STable.addInternalMethod('$$pop', function() {
      throw new NQPException('Cannot pop a fixed dimension array');
    });

    STable.addInternalMethod('$$shift', function() {
      throw new NQPException('Cannot shift a fixed dimension array');
    });

    STable.addInternalMethod('$$unshift', function(value) {
      throw new NQPException('Cannot unshift a fixed dimension array');
    });

    STable.addInternalMethod('$$push', function(value) {
      throw new NQPException('Cannot push a fixed dimension array');
    });

    STable.addInternalMethod('$$splice', function(value) {
      throw new NQPException('Cannot splice a fixed dimension array');
    });

    STable.addInternalMethod('$$calculateIndex', function(idx, value) {
      idx = idx.array;
      if (idx.length != STable.dimensions) {
        throw new NQPException('Cannot access ' + STable.dimensions + ' dimension array with ' + idx.length + ' indices');
      }

      for (var i = 0; i < idx.length; i++) {
        if (idx[i] < 0 || idx[i] >= this.dimensions[i]) {
          throw new NQPException('Index ' + idx[i] + ' for dimension ' + (i + 1) + ' out of range (must be 0..' + this.dimensions[i] + ')');
        }
      }
      var calculatedIdx = 0;
      for (var i = 0; i < idx.length; i++) {
        calculatedIdx = calculatedIdx * this.dimensions[i] + idx[i];
      }
      return calculatedIdx;
    });

    STable.addInternalMethod('$$atposnd', function(idx) {
      if (STable.primType != 0) throw new NQPException('wrong type');
      return this.storage[this.$$calculateIndex(idx)];
    });

    STable.addInternalMethod('$$bindposnd', function(idx, value) {
      if (STable.primType != 0) throw new NQPException('wrong type: ' + STable.primType);
      return (this.storage[this.$$calculateIndex(idx)] = value);
    });

    STable.addInternalMethod('$$atposnd_i', function(idx) {
      if (STable.primType != 1) throw new NQPException('wrong type: ' + STable.primType);
      return this.storage[this.$$calculateIndex(idx)];
    });

    STable.addInternalMethod('$$bindposnd_i', function(idx, value) {
      if (STable.primType != 1) throw new NQPException('wrong type' + STable.primType);
      return (this.storage[this.$$calculateIndex(idx)] = value);
    });

    STable.addInternalMethod('$$atposnd_n', function(idx) {
      if (STable.primType != 2) throw new NQPException('wrong type');
      return this.storage[this.$$calculateIndex(idx)];
    });

    STable.addInternalMethod('$$bindposnd_n', function(idx, value) {
      if (STable.primType != 2) throw new NQPException('wrong type');
      return (this.storage[this.$$calculateIndex(idx)] = value);
    });

    STable.addInternalMethod('$$atposnd_s', function(idx) {
      if (STable.primType != 3) throw new NQPException('wrong type');
      return this.storage[this.$$calculateIndex(idx)];
    });

    STable.addInternalMethod('$$bindposnd_s', function(idx, value) {
      if (STable.primType != 3) throw new NQPException('wrong type');
      return (this.storage[this.$$calculateIndex(idx)] = value);
    });

    // TODO optimize access
    STable.addInternalMethod('$$bindpos', function(index, value) {
      return this.$$bindposnd(new NQPArray([index]), value);
    });

    STable.addInternalMethod('$$setelems', function(elems) {
      this.$$setdimensions(new NQPArray([elems]));
    });

    STable.addInternalMethod('$$elems', function(elems) {
      return this.dimensions[0];
    });

    STable.addInternalMethod('$$atpos', function(index) {
      return this.$$atposnd(new NQPArray([index]));
    });
  }

  serializeReprData (st, cursor) {
    if (st.dimensions) {
      cursor.varint(st.dimensions);
      cursor.ref(st.type);
    } else {
      cursor.varint(0);
    }
  }

  deserializeReprData (cursor, STable) {
    var dims = cursor.varint();
    if (dims > 0) {
      STable.dimensions = dims;
      STable.type = cursor.variant();
      STable.primType = STable.type ? STable.type._STable.REPR.boxedPrimitive : 0;
    }
  }

  valuesSize (obj) {
    var size = 1;
    for (var i = 0; i < obj.dimensions.length; i++) {
      size = size * obj.dimensions[i];
    }
    return size;
  }

  serialize (cursor, obj) {
    for (var i = 0; i < obj._STable.dimensions; i++) {
      cursor.varint(obj.dimensions[i]);
    }
    var size = this.valuesSize(obj);
    for (var i = 0; i < size; i++) {
      switch (obj._STable.primType) {
        case 0:
          cursor.ref(obj.storage[i]);
          break;
        case 1:
          cursor.varint(obj.storage[i]);
          break;
        case 2:
          cursor.double(obj.storage[i]);
          break;
        case 3:
          cursor.str(obj.storage[i]);
          break;
      }
    }
  }

  deserializeFinish (obj, data) {
    obj.dimensions = [];
    for (var i = 0; i < obj._STable.dimensions; i++) {
      obj.dimensions[i] = data.varint();
    }
    var size = this.valuesSize(obj);
    obj.storage = [];
    for (var i = 0; i < size; i++) {
      switch (obj._STable.primType) {
        case 0:
          obj.storage[i] = data.variant();
          break;
        case 1:
          obj.storage[i] = data.varint();
          break;
        case 2:
          obj.storage[i] = data.double();
          break;
        case 3:
          obj.storage[i] = data.str();
          break;
      }
    }
  }

}







reprs.VMException = class VMException {
  constructor() {
    this.allocate = basicAllocate;
    this.typeObjectFor = basicTypeObjectFor;
    this.compose = noopCompose;
    this.basicTypeObjectFor = basicTypeObjectFor;
    this.createObjConstructor = basicConstructor;
  }

  setup_STable (STable) {
    STable.addInternalMethod('$$getStr', function() {
      return this.message;
    });
  }
}


reprs.NativeRef = class NativeRef { 
  constructor() {
    this.allocate = basicAllocate;
    this.createObjConstructor = basicConstructor;
    this.typeObjectFor = basicTypeObjectFor;
    this.compose = noopCompose;
  }
}

var ID = 0;
for (var name in reprs) {
  module.exports[name] = reprs[name];
  reprs[name].prototype.ID = ID;
  reprById[ID] = reprs[name];
  ID++;
}
