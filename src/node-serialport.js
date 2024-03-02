/* eslint no-await-in-loop: 0 */
const { SerialPort } = require('serialport');
const EventEmitter = require('eventemitter3');

class NodeSerialPort extends EventEmitter {
  constructor(portPath, baudRate) {
    super();

    this.portPath = portPath;
    this.baudRate = baudRate;

    this.port = null;
    this.reader = null;
    this.buffer = '';
  }

  async connect() {
    this.port = new SerialPort({
      path: this.portPath,
      baudRate: this.baudRate,
    });

    this.port.on('data', (data) => {
      this.emit('data', data);

      this.buffer += data;
      const lines = this.buffer.split(/\r\n|\n\r/);

      if (lines.length > 1) {
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i];
          this.emit('line', line);
          console.log('rx:', line);
        }

        this.buffer = lines[lines.length - 1];
      }
    });

    this.port.on('error', (error) => {
      console.error('Error opening serial port:', error);
      this.port = null;
    });
  }

  async write(data) {
    if (!this.port) {
      throw new Error('Serial port is not connected');
    }

    this.port.write(data);
  }

  async print(str) {
    console.log('tx:', str);
    await this.write(str);
  }

  async disconnect() {
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }
}

module.exports = NodeSerialPort;
