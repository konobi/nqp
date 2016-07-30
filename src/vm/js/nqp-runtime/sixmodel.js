'use strict';

var incompleteMethodCaches = [];
function get_bool_methods(mode, method) {
  var methods = [
    function(ctx){ return method.$call(ctx, {}, this); },
    function(ctx){ return !(this.$$getInt() == 0) },
    function(ctx){ return !(this.$$getNum() == 0) },
    function(ctx){ return !(this.$$getStr() == '') },
    function(ctx){ var str = this.$$getStr(); return !(str == '' || str == '0') },
    null,
    function(ctx){ return !(this.$$getBignum().eq(0)) },
    null,
    function(ctx){ return !!(this.$$elems()) },
  ];
  if(mode > methods.length) throw 'setboolspec with mode: ' + mode + ' NYI';
  
  return methods[mode];
}

class STable {

  constructor (REPR, HOW) {
    this.REPR = REPR;
    this.HOW = HOW;
    this.modeFlags = 0;
    this.objConstructor = REPR.createObjConstructor(this);
    this.boolificationSpec;

    /* HACK - it's a bit hackish - think how correct it is */
    if (!('$$clone' in this.objConstructor.prototype)){
      this.objConstructor.prototype.$$clone = () => {
        var clone = new this._STable.objConstructor();
        clone = Object.assign(clone, this);
        clone._SC = null;
        return clone;
      };
    }

    /* Default boolification mode 5 */
    this.objConstructor.prototype.$$toBool = (ctx) => {
      return !(this.typeObject_); 
    };

    if ('setup_STable' in this.REPR) {
      this.REPR.setup_STable(this);
    }
  }


  setboolspec(mode, method) {
    this.boolificationSpec = {mode: mode, method: method};
    var func = get_bool_methods(mode, method);
    if(func) this.objConstructor.prototype.$$toBool = func;
  }


  setinvokespec (classHandle, attrName, invocationHandler) {
    if (classHandle) {
      var attr = this.REPR.getAttr(classHandle, attrName);

      this.objConstructor.prototype.$call = () => {
        return (this[attr] && ('$call' in this[attr])) 
            ? this[attr].$call.apply(this[attr], arguments) 
            : undefined;
      }
      this.objConstructor.prototype.$apply = (args) => {
        return (this[attr] && ('$apply' in this[attr]))
            ? this[attr].$apply.apply(this[attr], args) 
            : undefined;
      }
      this.objConstructor.prototype.$$injectMethod = (proto, name) => {
        return (this[attr] && ('$$injectMethod' in this[attr]))
            ? this[attr].$$injectMethod(proto, name)
            : undefined;
      }
    } else {
      this.objConstructor.prototype.$call = () => {
        var args = [];
        args.push(arguments[0]);
        args.push(arguments[1]);
        args.push(this);
        for (var i = 2; i < arguments.length; i++) {
          args.push(arguments[i]);
        }
        return invocationHandler.$apply(args);
      }

      this.objConstructor.prototype.$apply = (args) => {
        var newArgs = [];
        newArgs.push(args[0]);
        newArgs.push(args[1]);
        newArgs.push(this);
        for (var i = 2; i < args.length; i++) {
          newArgs.push(args[i]);
        }
        return invocationHandler.$apply(newArgs);
      }
    }

    this.invocationSpec = {classHandle: classHandle, attrName: attrName, invocationHandler: invocationHandler};

    var setAgain = incompleteMethodCaches;
    incompleteMethodCaches = [];
    for (var i = 0; i < setAgain.length; i++) {
      setAgain[i].setMethodCache(setAgain[i].methodCache);
    }
  }

  createTypeObject () {
    var obj = new this.objConstructor();
    obj.typeObject_ = true;
    obj.$$atkey = () => null;
    obj.$$atpos = () => null;
    obj.$$decont = () => obj;
    return obj;
  }

  setMethodCache (methodCache) {
    // TODO delete old methods
    var proto = this.objConstructor.prototype;
    this.methodCache = methodCache;
    var notReadyYet = false;
    for (let name in methodCache) {
      if (name in methodCache) {
        injectMethod(proto, name, methodCache[name]);
        if (!('$call' in methodCache[name])) notReadyYet = true;
      }
    }

    if (notReadyYet) {
      incompleteMethodCaches.push(this);
    }
  };

  setPositionalDelegate (attr) {
    this.objConstructor.prototype.$$bindpos = (index, value) => {
      return this[attr].$$bindpos(index, value);
    }

    this.objConstructor.prototype.$$atpos = (index) => {
      return this[attr].$$atpos(index);
    }

    this.objConstructor.prototype.$$unshift = (value) => {
      return this[attr].$$unshift(value);
    }

    this.objConstructor.prototype.$$pop = (value) => {
      return this[attr].$$pop(value);
    }

    this.objConstructor.prototype.$$push = (value) => {
      return this[attr].$$push(value);
    }

    this.objConstructor.prototype.$$shift = (value) => {
      return this[attr].$$shift(value);
    }

    this.objConstructor.prototype.$$elems = (value) => {
      return this[attr].$$elems();
    }
  }

  setAssociativeDelegate (attr) {
    this.objConstructor.prototype.$$bindkey = (key, value) => {
      return this[attr].$$bindkey(key, value);
    };
    this.objConstructor.prototype.$$atkey = (key) => {
      return this[attr].$$atkey(key);
    };
    this.objConstructor.prototype.$$existskey = (key) => {
      return this[attr].$$existskey(key);
    };
    this.objConstructor.prototype.$$deletekey = (key) => {
      return this[attr].$$deletekey(key);
    };
  }

  addInternalMethod (name, func) {
    this.objConstructor.prototype[name] = func;
  }

}

function injectMethod(proto, name, method) {
  proto[name] = () => {
    return method.$call.apply(method, arguments);
  };

  if (method.$$injectMethod) {
    method.$$injectMethod(proto, name);
  }
}


module.exports.STable = STable;
