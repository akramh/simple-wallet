/**
 * @file stream.js
 * @description Stub for Node.js 'stream' module in React Native
 * 
 * Most stream functionality is not used in the wallet SDK's
 * mobile code path, but imports may exist.
 */

class EventEmitter {
  constructor() {
    this._events = {};
  }
  
  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }
  
  off(event, listener) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(l => l !== listener);
    }
    return this;
  }
  
  emit(event, ...args) {
    if (this._events[event]) {
      this._events[event].forEach(listener => listener(...args));
    }
    return this;
  }
  
  once(event, listener) {
    const wrapper = (...args) => {
      listener(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }
  
  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }
}

class Stream extends EventEmitter {
  pipe(dest) {
    return dest;
  }
}

class Readable extends Stream {
  read() {
    return null;
  }
  
  push(chunk) {
    return true;
  }
}

class Writable extends Stream {
  write(chunk, encoding, callback) {
    if (callback) callback();
    return true;
  }
  
  end(chunk, encoding, callback) {
    if (typeof chunk === 'function') {
      chunk();
    } else if (callback) {
      callback();
    }
  }
}

class Duplex extends Stream {
  read() {
    return null;
  }
  
  write(chunk, encoding, callback) {
    if (callback) callback();
    return true;
  }
}

class Transform extends Duplex {
  _transform(chunk, encoding, callback) {
    callback(null, chunk);
  }
}

class PassThrough extends Transform {}

module.exports = {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
};
