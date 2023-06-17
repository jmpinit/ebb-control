/* eslint no-await-in-loop: 0 */
const EventEmitter = require('eventemitter3');

class SerialPort extends EventEmitter {
  constructor() {
    super();

    this.connected = false;
  }

  // eslint-disable-next-line class-methods-use-this,no-empty-function,no-unused-vars
  async connect(baudRate) {
    this.connected = true;
  }

  // eslint-disable-next-line class-methods-use-this,no-unused-vars
  write(data) {
    // The library only ever calls `print`
    throw new Error('Unexpected use of write');
  }

  async print(str) {
    if (!this.connected) {
      throw new Error('Not connected');
    }
  }

  async disconnect() {
    this.connected = false;
  }
}

module.exports = SerialPort;
