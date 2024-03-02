/* eslint no-await-in-loop: 0 */
const EventEmitter = require('eventemitter3');

class WebSerialPort extends EventEmitter {
  constructor(baudRate) {
    super();

    this.baudRate = baudRate;
    this.port = null;
    this.reader = null;
    this.buffer = '';
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });

    // Start listening for incoming data
    this.listen().then();
  }

  async listen() {
    while (this.port.readable) {
      try {
        this.reader = this.port.readable.getReader();
        const { value, done } = await this.reader.read();

        if (done) {
          // The stream was canceled by the browser, close reader and exit
          await this.reader.cancel();
          return;
        }

        // Emit the 'data' event with the incoming data
        this.emit('data', value);

        this.buffer += new TextDecoder().decode(value);
        const lines = this.buffer.split(/\r\n|\n\r/);

        if (lines.length > 1) {
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i];
            this.emit('line', line);
            console.log('rx:', line);
          }

          this.buffer = lines[lines.length - 1];
        }
      } catch (error) {
        // Handle any errors that occurred while reading the data
        console.error('Error reading data from serial port', error);
      } finally {
        // Make sure to release the lock on the reader
        if (this.reader) {
          this.reader.releaseLock();
        }
      }
    }
  }

  async write(data) {
    if (!this.port || !this.port.writable) {
      throw new Error('Serial port is not writable or not connected');
    }

    this.writer = this.port.writable.getWriter();
    await this.writer.write(data);
    this.writer.releaseLock();
  }

  async print(str) {
    console.log('tx:', str);
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    await this.write(data);
  }

  async disconnect() {
    if (this.reader) {
      await this.reader.cancel();
      await this.reader.releaseLock();
    }

    if (this.port) {
      await this.port.close();
      this.port = null;
    }
  }
}

module.exports = WebSerialPort;
