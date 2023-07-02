// See https://evil-mad.github.io/EggBot/ebb.html

const SerialPort = require('./serial');

const BAUD_RATE = 115200;

const PEN_DOWN = 0;
const PEN_UP = 1;

const MOTOR_DISABLE = 0;
const MOTOR_STEP_DIV16 = 1;
const MOTOR_STEP_DIV8 = 2;
const MOTOR_STEP_DIV4 = 3;
const MOTOR_STEP_DIV2 = 4;
const MOTOR_STEP_DIV1 = 5;

const SERVO_POWER_ON = 1;

const MODE_DIGITAL = 0;
const MODE_ANALOG = 1;

function assertByte(value) {
  if (value < 0 || value > 255) {
    throw new Error('Byte value must be between 0 and 255.');
  }

  if (!Number.isInteger(value)) {
    throw new Error('Byte values must be integers.');
  }
}

function assertValidPortLetter(portLetter) {
  if (['A', 'B', 'C', 'D', 'E'].indexOf(portLetter) === -1) {
    throw new Error('Port letter must be A, B, C, D, or E.');
  }
}

class EiBotBoard {
  constructor() {
    this.port = new SerialPort();

    this.pending = [];
    this.responseHandlers = [];

    this.port.on('line', (line) => {
      if (this.responseHandlers.length === 0) {
        console.log(`Received unexpected message from EBB: ${line}`);
        return;
      }

      const handleResponse = this.responseHandlers.shift();
      handleResponse(line);
    });
  }

  connect() {
    return this.port.connect(BAUD_RATE);
  }

  command(cmd, numResponseLines = 1, timeout = 3000) {
    const responsePromise = new Promise((fulfill, reject) => {
      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Command "${cmd}" timed out`));
      }, timeout);

      const lines = [];

      for (let i = 0; i < numResponseLines; i += 1) {
        // eslint-disable-next-line no-loop-func
        this.responseHandlers.push((line) => {
          if (timedOut) {
            return;
          }

          lines.push(line);

          if (lines.length === numResponseLines) {
            clearTimeout(timeoutId);
            fulfill(lines.join('\r\n'));
          }
        });
      }
    });

    return new Promise((fulfill) => {
      const executeCommand = () => this.port.print(`${cmd}\r`)
        .then(() => responsePromise)
        .then((response) => {
          fulfill(response);

          // Remove ourselves from the pending queue
          this.pending.shift();

          // Execute the next command if there is one
          if (this.pending.length > 0) {
            this.pending[0]().then();
          }
        });

      const othersPending = this.pending.length > 0;
      this.pending.push(executeCommand);

      if (!othersPending) {
        executeCommand().then();
      }
    });
  }

  // EBB API
  // See https://evil-mad.github.io/EggBot/ebb.html

  /**
   * Read all analog input values.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#A}.
   * @returns {Promise<*>} - Resolves with an object whose keys are the analog.
   *   channel numbers and whose values are the analog values (0-1023).
   */
  async analogValueGet() {
    const response = await this.command('A');

    // EBB returns 10 bit values for each channel 0-1023 and 0V to 3.3V.
    // Only channels that are enabled will be returned.
    // Channel number is padded to 2 characters
    // ADC value is padded to 4 characters
    // Example: A,00:0713,02:0241,05:0089:09:1004<CR><NL>

    return response.split(',').slice(1)
      .reduce((readings, channelValueStr) => {
        const [channel, value] = channelValueStr
          .split(':')
          .map((v) => parseInt(v, 10));

        return {
          ...readings,
          [channel]: value,
        };
      }, {});
  }

  /**
   * Configure an analog input channel.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#AC}.
   * @param {number} channel - The analog channel number (0-15).
   * @param {boolean} enabled - Whether the channel should be enabled.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async analogConfigure(channel, enabled) {
    if (channel < 0 || channel > 15) {
      throw new Error(`Channel must be between 0 and 15. Is ${channel}`);
    }

    const response = await this.command(`AC,${channel},${enabled ? 1 : 0}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Enter bootloader mode.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#BL}.
   * @returns {Promise<void>} - Resolves after the EBB has been disconnected.
   */
  async enterBootloader() {
    // The EBB should disconnect in response to this command
    // and reconnect as a different port

    await this.command('BL');
    return this.port.disconnect();
  }

  /**
   * Configure all pins as inputs or outputs at once.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#C} and
   * {@link http://ww1.microchip.com/downloads/en/DeviceDoc/39931d.pdf|the PIC18F46J50 datasheet}.
   * A pin is an input if the corresponding bit in the TRIS register is 1.
   * @param {number} portA - The 8-bit TRISA value to set.
   * @param {number} portB - The 8-bit TRISB value to set.
   * @param {number} portC - The 8-bit TRISC value to set.
   * @param {number} portD - The 8-bit TRISD value to set.
   * @param {number} portE - The 8-bit TRISE value to set.
   */
  async configurePinDirections(portA, portB, portC, portD, portE) {
    assertByte(portA);
    assertByte(portB);
    assertByte(portC);
    assertByte(portD);
    assertByte(portE);

    const response = await this.command(`C,${portA},${portB},${portC},${portD},${portE}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Zero the motor step positions.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#CS}.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async clearStepPosition() {
    const response = await this.command('CS');

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Configure user interface options.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#CU}.
   * @param {boolean} [enableOkResponse] - Whether to send an "OK" response to each command.
   * @param {boolean} [enableParameterLimitChecking] - Whether to check parameter limits.
   * @param {boolean} [enableFifoLedIndicator] - Whether to light the LED when the FIFO is empty.
   */
  async configureUserOptions(
    enableOkResponse = true,
    enableParameterLimitChecking = true,
    enableFifoLedIndicator = false,
  ) {
    await this.command(`CU,1,${enableOkResponse ? 1 : 0}`);
    await this.command(`CU,2,${enableParameterLimitChecking ? 1 : 0}`);
    await this.command(`CU,3,${enableFifoLedIndicator ? 1 : 0}`);
  }

  /**
   * Enable or disable stepper motors and set step mode.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#EM}.
   * @param {number} m1Mode - Step mode for motor 1.
   * @param {number} m2Mode - Step mode for motor 2.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async enableMotors(m1Mode, m2Mode) {
    const response = await this.command(`EM,${m1Mode},${m2Mode}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * @typedef {Object} EStopInfo
   * @property {boolean} interrupted - Whether the command was interrupted.
   * @property {Array<number>} fifoSteps - Number of steps remaining in the FIFO for each motor.
   * @property {Array<number>} stepsRemaining - Number of steps remaining in the
   *  current command for each motor.
   */

  /**
   * Aborts any in-progress motor move and deletes any motor move commands from the FIFO.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#ES}.
   * @param {boolean} [disableMotors] - Whether to de-energize the motors.
   * @returns {Promise<EStopInfo>} - Resolves after the command has been acknowledged.
   */
  async emergencyStop(disableMotors) {
    const response = disableMotors ? await this.command('ES,1', 2) : await this.command('ES', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [info, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [interrupted, fifoSteps1, fifoSteps2, stepsRem1, stepsRem2] = info.split(',');

    return {
      interrupted: interrupted === '1',
      fifoSteps: [
        parseInt(fifoSteps1, 10),
        parseInt(fifoSteps2, 10),
      ],
      stepsRemaining: [
        parseInt(stepsRem1, 10),
        parseInt(stepsRem2, 10),
      ],
    };
  }

  /**
   * Move to an absolute position relative to home.
   * Only meant for "utility" moves rather than smooth/fast motion. Read the
   * current global position using QS (@see queryStepPosition) and clear it
   * using CS (@see clearStepPosition). If no destination position is specified,
   * then the move is towards the Home position (0, 0).
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#HM}.
   * @param {number} stepFrequency - The step frequency in Hz (2-25000).
   * @param {number} [position1] - The absolute position for motor 1 (+/-4,294,967).
   * @param {number} [position2] - The absolute position for motor 2 (+/-4,294,967).
   */
  async absoluteMove(stepFrequency, position1 = 0, position2 = 0) {
    if (stepFrequency < 2 || stepFrequency > 25000) {
      throw new Error('Step frequency must be between 2 and 25000.');
    }

    // The docs give 4,294,967 as the max position, but maybe that's a mistake?
    // 2^32-1 is 4,294,967,295. But then again, we need a sign bit here.
    const maxPosition = 4294967;

    if (position1 < -maxPosition || position1 > maxPosition) {
      throw new Error('Motor 1 position must be between -4294967 and 4294967.');
    }

    if (position2 < -maxPosition || position2 > maxPosition) {
      throw new Error('Motor 2 position must be between -4294967 and 4294967.');
    }

    const response = await this.command(`HM,${stepFrequency},${position1},${position2}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Read every byte-wide PORTx register (A-E) and return the values.
   * @returns {Promise<Array<number>>} - Resolves with an array of the port values.
   */
  async getInput() {
    // Reads all pins as digital inputs
    const response = await this.command('I');

    if (!response.startsWith('I')) {
      throw new Error(`Received unexpected response: ${response}`);
    }

    const [, ...portStates] = response.split(',');
    return portStates.map((state) => parseInt(state, 10));
  }

  /**
   * Low-level, step-limited move command.
   * Causes one or both motors to move for a given number of steps, and allows
   * the option of applying a constant acceleration to one or both motors during
   * their movement. The motion terminates for each axis when the required
   * number of steps have been made, and the command is complete when the both
   * motors have reached their targets.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#LM}.
   * @param {number} m1Rate - Step rate for motor 1 (0 to 2^31-1). Added to the
   *   motor 1 accumulator at each control interval (40us).
   * @param {number} m1Steps - Number of steps for motor 1 (-2^31 to 2^31-1).
   * @param {number} m1Accel - Added to the step rate at each control interval (40us).
   * @param {boolean} m1Clear - Zeroes the motor 1 accumulator before starting if true.
   * @param {number} m2Rate - Step rate for motor 2 (0 to 2^31-1). Added to the
   *   motor 2 accumulator at each control interval (40us).
   * @param {number} m2Steps - Number of steps for motor 2 (-2^31 to 2^31-1).
   * @param {number} m2Accel - Added to the step rate at each control interval (40us).
   * @param {boolean} m2Clear - Zeroes the motor 2 accumulator before starting if true.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async lowLevelMove(m1Rate, m1Steps, m1Accel, m1Clear, m2Rate, m2Steps, m2Accel, m2Clear) {
    if (m1Rate < 0 || m1Rate > 2 ** 31 - 1) {
      throw new Error('Motor 1 rate must be between 0 and 2^31-1.');
    }

    if (m2Rate < 0 || m2Rate > 2 ** 31 - 1) {
      throw new Error('Motor 2 rate must be between 0 and 2^31-1.');
    }

    if (m1Steps < -(2 ** 31) || m1Steps > 2 ** 31 - 1) {
      throw new Error('Motor 1 steps must be between -2^31 and 2^31-1.');
    }

    if (m2Steps < -(2 ** 31) || m2Steps > 2 ** 31 - 1) {
      throw new Error('Motor 2 steps must be between -2^31 and 2^31-1.');
    }

    if (m1Accel < -(2 ** 31) || m1Accel > 2 ** 31 - 1) {
      throw new Error('Motor 1 acceleration must be between -2^31 and 2^31-1.');
    }

    if (m2Accel < -(2 ** 31) || m2Accel > 2 ** 31 - 1) {
      throw new Error('Motor 2 acceleration must be between -2^31 and 2^31-1.');
    }

    const clearValue = (m2Clear ? 2 : 0) + (m1Clear ? 1 : 0);

    const response = await this.command(`LM,${m1Rate},${m1Steps},${m1Accel},${m2Rate},${m2Steps},${m2Accel},${clearValue}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Low-level, time-limited move command.
   * causes one or both motors to move for a given duration of time, and allows
   * the option of applying a constant acceleration to one or both motors during
   * their movement. The motion terminates for each axis when the required
   * number of time intervals has elapsed.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#LT}.
   * @param {number} intervals - Number of 40us time intervals for the motors to move (0 to 2^31-1).
   * @param {number} m1Rate - Step rate for motor 1 (-(2^31-1) to 2^31-1).
   *   Absolute value is added to the motor 1 accumulator at each control interval
   *   (40us). Sign determines direction.
   * @param {number} m1Accel - Added to the step rate at each control interval (40us). -2^31 to
   *   2^31-1.
   * @param {boolean} m1Clear - Zeroes the motor 1 accumulator before starting if true.
   * @param {number} m2Rate - Step rate for motor 2 (-(2^31-1) to 2^31-1).
   *   Absolute value is added to the motor 2 accumulator at each control interval
   *   (40us). Sign determines direction.
   * @param {number} m2Accel - Added to the step rate at each control interval (40us). -2^31 to
   *   2^31-1.
   * @param {boolean} m2Clear - Zeroes the motor 2 accumulator before starting if true.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async lowLevelMoveTimeLimited(intervals, m1Rate, m1Accel, m1Clear, m2Rate, m2Accel, m2Clear) {
    if (m1Rate < 0 || m1Rate > 2 ** 31 - 1) {
      throw new Error('Motor 1 rate must be between 0 and 2^31-1.');
    }

    if (m2Rate < 0 || m2Rate > 2 ** 31 - 1) {
      throw new Error('Motor 2 rate must be between 0 and 2^31-1.');
    }

    if (m1Accel < -(2 ** 31) || m1Accel > 2 ** 31 - 1) {
      throw new Error('Motor 1 acceleration must be between -2^31 and 2^31-1.');
    }

    if (m2Accel < -(2 ** 31) || m2Accel > 2 ** 31 - 1) {
      throw new Error('Motor 2 acceleration must be between -2^31 and 2^31-1.');
    }

    const clearValue = (m2Clear ? 2 : 0) + (m1Clear ? 1 : 0);

    const response = await this.command(`LT,${intervals},${m1Rate},${m1Accel},${m2Rate},${m2Accel},${clearValue}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Read memory address.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#MR}.
   * @param {number} address - Address to read (0 to 4095).
   * @returns {Promise<number>} - Resolves with the value at the given address.
   */
  async memoryRead(address) {
    if (address < 0 || address > 4095) {
      throw new Error('Address must be between 0 and 4095.');
    }

    const response = await this.command(`MR,${address}`);

    const [cmdName, value] = response.split(',');

    if (cmdName !== 'MR') {
      throw new Error(`Received unexpected response: ${response}`);
    }

    return parseInt(value, 10);
  }

  /**
   * Write given memory address.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#MW}.
   * @param {number} address - Address to write (0 to 4095).
   * @param {number} value - Value to write (0 to 255).
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async memoryWrite(address, value) {
    if (address < 0 || address > 4095) {
      throw new Error('Address must be between 0 and 4095.');
    }

    assertByte(value);

    const response = await this.command(`MW,${address},${value}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Decrement the node counter by 1.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#ND}.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async nodeCountDecrement() {
    const response = await this.command('ND');

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Increment the node counter by 1.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#NI}.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async nodeCountIncrement() {
    const response = await this.command('NI');

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Output digital values to the pins of the microcontroller.
   * The pins must have been configured as digital outputs.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#O}.
   * @param {number} portA - Value to write to port A (0 to 255).
   * @param {number} portB - Value to write to port B (0 to 255).
   * @param {number} portC - Value to write to port C (0 to 255).
   * @param {number} portD - Value to write to port D (0 to 255).
   * @param {number} portE - Value to write to port E (0 to 255).
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async setOutputs(portA, portB, portC, portD, portE) {
    assertByte(portA);
    assertByte(portB);
    assertByte(portC);
    assertByte(portD);
    assertByte(portE);

    const response = await this.command(`O,${portA},${portB},${portC},${portD},${portE}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Configures the pulse generator parameters.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#PC}.
   * @param {number} duration0 - Duration in milliseconds that pulse 0 will be high (0 to 65535).
   * @param {number} period0 - Period for pulse 0 in milliseconds (0 to 65535).
   * @param {number} duration1 - Duration in milliseconds that pulse 1 will be high (0 to 65535).
   * @param {number} period1 - Period for pulse 1 in milliseconds (0 to 65535).
   * @param {number} duration2 - Duration in milliseconds that pulse 2 will be high (0 to 65535).
   * @param {number} period2 - Period for pulse 2 in milliseconds (0 to 65535).
   * @param {number} duration3 - Duration in milliseconds that pulse 3 will be high (0 to 65535).
   * @param {number} period3 - Period for pulse 3 in milliseconds (0 to 65535).
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async pulseConfigure(
    duration0,
    period0,
    duration1,
    period1,
    duration2,
    period2,
    duration3,
    period3,
  ) {
    const response = await this.command(`PC,${duration0},${period0},${duration1},${period1},${duration2},${period2},${duration3},${period3}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Set the direction of a pin.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#PD}.
   * @param {string} portLetter - Letter of the processor port the pin belongs to. A, B, C, D, or E.
   * @param {number} pinIndex - Index of the pin to use. 0 to 7.
   * @param {boolean} isOutput - Set pin to output if true, input if false.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async setPinDirection(portLetter, pinIndex, isOutput) {
    assertValidPortLetter(portLetter);

    if (pinIndex < 0 || pinIndex > 7) {
      throw new Error('Pin index must be between 0 and 7.');
    }

    const response = await this.command(`PD,${portLetter},${pinIndex},${isOutput ? 0 : 1}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Start or stop pulse generation.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#PG}.
   * @param {boolean} enabled - Start pulse generation if true, stop if false.
   * @returns {Promise<void>} - Resolves after the command has been acknowledged.
   */
  async pulseGo(enabled) {
    const response = await this.command(`PG,${enabled ? 1 : 0}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Read the state of a pin.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#PI}.
   * @param {string} portLetter - Letter of the processor port the pin belongs to. A, B, C, D, or E.
   * @param {number} pinIndex - Index of the pin to use. 0 to 7.
   * @returns {Promise<boolean>} - Resolves with true if the pin is high, false if low.
   */
  async pinInput(portLetter, pinIndex) {
    assertValidPortLetter(portLetter);

    if (pinIndex < 0 || pinIndex > 7) {
      throw new Error('Pin index must be between 0 and 7.');
    }

    const response = await this.command(`PI,${portLetter},${pinIndex}`);

    const [cmd, value] = response.split(',');

    if (cmd !== 'PI') {
      throw new Error(`Received unexpected response: ${response}`);
    }

    return value === '1';
  }

  /**
   * Write a digital value to a pin.
   * @param portLetter - A, B, C, D, or E.
   * @param {string} portLetter - Letter of the processor port the pin belongs to. A, B, C, D, or E.
   * @param {number} pinIndex - Index of the pin to use. 0 to 7.
   * @param {boolean} setPinHigh - Set pin high if true, low if false.
   * @returns {Promise<void>}
   */
  async pinOutput(portLetter, pinIndex, setPinHigh) {
    assertValidPortLetter(portLetter);

    if (pinIndex < 0 || pinIndex > 7) {
      throw new Error('Pin index must be between 0 and 7.');
    }

    const response = await this.command(`PO,${portLetter},${pinIndex},${setPinHigh ? 1 : 0}`);

    if (response !== 'OK') {
      throw new Error(`Received unexpected response: ${response}`);
    }
  }

  /**
   * Query whether the button was pressed since the last time this command was called.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QB}.
   * @returns {Promise<boolean>} - Resolves with true if the button was pressed, false if not.
   */
  async queryButton() {
    const response = await this.command('QB', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [buttonStatus, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return buttonStatus === '1';
  }

  /**
   * Read the max current setting and the power voltage.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QC}.
   * @param {boolean} oldBoard - Set to true if using an EBB board v2.2 or older.
   * @returns {Promise<{maxCurrent: number, powerVoltage: number}>} - Resolves
   *   with the max current setting and the power voltage.
   */
  async queryCurrent(oldBoard = false) {
    const response = await this.command('QC', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [currentStatus, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [ra0VoltageRaw, vpVoltageRaw] = currentStatus
      .split(',')
      .map((voltage) => parseInt(voltage, 10));

    const ra0Voltage = (3.3 * ra0VoltageRaw) / 1023.0;
    const maxCurrent = ra0Voltage / 1.76;

    const oldResistorDividerScale = 1 / 11.0; // EBB boards v2.2 and older
    const newResistorDividerScale = 1 / 9.2; // EBB boards v2.3 and newer

    const vpVoltage = (3.3 * vpVoltageRaw) / 1023.0;
    const diodeVoltageDrop = 0.3;
    const powerVoltage = vpVoltage
      / (oldBoard ? oldResistorDividerScale : newResistorDividerScale)
      + diodeVoltageDrop;

    return {
      maxCurrent,
      powerVoltage,
    };
  }

  /**
   * Query the current motor configuration.
   * Firmware versions v2.8.0 and newer.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QE}.
   * @returns {Promise<Array<number>>} - Resolves with an array of step modes for each motor.
   */
  async queryMotorConfig() {
    const response = await this.command('QE', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [motorStatus, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [m1Mode, m2Mode] = motorStatus
      .split(',')
      .map((mode) => parseInt(mode, 10));

    const motorStates = {
      0: MOTOR_DISABLE,
      1: MOTOR_STEP_DIV1,
      2: MOTOR_STEP_DIV2,
      4: MOTOR_STEP_DIV4,
      8: MOTOR_STEP_DIV8,
      16: MOTOR_STEP_DIV16,
    };

    if (!(m1Mode in motorStates) || !(m2Mode in motorStates)) {
      throw new Error(`Unexpected response: ${response}`);
    }

    return [motorStates[m1Mode], motorStates[m2Mode]];
  }

  /**
   * @typedef {Object} GeneralStatus
   * @property {boolean} pinRB5 - True if pin RB5 is high.
   * @property {boolean} pinRB2 - True if pin RB2 is high.
   * @property {boolean} buttonPrg - True if the PRG button was pressed since last QG or QB command.
   * @property {boolean} penDown - True if the pen is down.
   * @property {boolean} commandExecuting - True if a command is executing.
   * @property {boolean} motor1Moving - True if motor 1 is moving.
   * @property {boolean} motor2Moving - True if motor 2 is moving.
   * @property {boolean} fifoEmpty - True if the FIFO is empty.
   */

  /**
   * Query the general status.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QG}.
   * @returns {Promise<GeneralStatus>} - Resolves with the general status.
   */
  async queryGeneral() {
    const response = await this.command('QG');

    const statusByte = parseInt(response, 16);

    // eslint-disable-next-line no-bitwise
    const bitSet = (byte, bit) => (byte & (1 << bit)) > 0;

    return {
      pinRB5: bitSet(statusByte, 7),
      pinRB2: bitSet(statusByte, 6),
      buttonPrg: bitSet(statusByte, 5),
      penDown: bitSet(statusByte, 4),
      commandExecuting: bitSet(statusByte, 3),
      motor1Moving: bitSet(statusByte, 2),
      motor2Moving: bitSet(statusByte, 1),
      fifoEmpty: !bitSet(statusByte, 0),
    };
  }

  /**
   * Query the current value of the layer variable.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QL}.
   * @returns {Promise<number>} - Resolves with the value of the current layer variable.
   */
  async queryLayer() {
    const response = await this.command('QL', 2);

    const [currentLayerStr, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return parseInt(currentLayerStr, 10);
  }

  /**
   * @typedef {Object} MotorStatus
   * @property {boolean} executingMotion - Whether a motion command is currently executing.
   * @property {Array<boolean>} motorMoving - Whether each motor is currently moving.
   * @property {boolean} fifoEmpty - Whether the motion FIFO is empty.
   */

  /**
   * Query the status of the motors and motion FIFO.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QM}.
   * @returns {MotorStatus}
   */
  async queryMotors() {
    const response = await this.command('QM');

    if (!response.startsWith('QM,')) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [, cmdStatus, m1Status, m2Status, fifoStatus] = response.split(',');

    return {
      executingMotion: parseInt(cmdStatus, 10) > 0,
      motorMoving: [
        m1Status === '1',
        m2Status === '1',
      ],
      fifoEmpty: parseInt(fifoStatus, 10) === 0,
    };
  }

  /**
   * Query the pen status.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QP}.
   * @returns {Promise<boolean>} - Whether the pen is down (true) or down (true).
   */
  async queryPen() {
    const response = await this.command('QP', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [penStatus, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return parseInt(penStatus, 10) === PEN_DOWN;
  }

  /**
   * Query the servo power status.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QR}.
   * @returns {Promise<boolean>} - True if the servo is receiving power.
   */
  async queryServoPower() {
    const response = await this.command('QR', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [servoPower, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return parseInt(servoPower, 10) === SERVO_POWER_ON;
  }

  /**
   * Query the step position of the motors.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QS}.
   * @returns {Promise<number[]>} - The step position of the motors.
   */
  async queryStepPosition() {
    const response = await this.command('QS', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [stepPosition, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [m1Steps, m2Steps] = stepPosition.split(',');

    return [
      parseInt(m1Steps, 10),
      parseInt(m2Steps, 10),
    ];
  }

  /**
   * Query the EBB's nickname.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QT}.
   * @returns {Promise<string>} - The nickname.
   */
  async queryNickname() {
    const response = await this.command('QT', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [name, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return name;
  }

  /**
   * Reboot the EBB.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#RB}.
   * @returns {Promise<void>} - Resolves when the EBB has been disconnected.
   */
  async reboot() {
    await this.command('RB'); // No response
    return this.port.disconnect();
  }

  /**
   * Reset the EBB.
   * @returns {Promise<void>} - Resolves when the EBB has been reset.
   */
  async reset() {
    const response = await this.command('R');

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Control the RC servo output system.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#S2}.
   * @param {number} position - The "on time" of the signal, in units of 1/12e6 seconds.
   * @param {number} pinIndex - The pin index to use.
   * @param {number} rate - Slew rate between last setting and the new one. 1/12e3 second per 24 ms.
   * @param {number} delay - Delay the next command in the motion queue by this many milliseconds.
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async servoOutput(position, pinIndex, rate, delay) {
    if (position < 0 || position > 2 ** 16 - 1) {
      throw new Error('Position must be between 0 and 2^16 - 1');
    }

    if (pinIndex < 0 || pinIndex > 24) {
      throw new Error('Pin index must be between 0 and 24');
    }

    if (rate < 0 || rate > 2 ** 16 - 1) {
      throw new Error('Rate must be between 0 and 2^16 - 1');
    }

    if (delay < 0 || delay > 2 ** 16 - 1) {
      throw new Error('Delay must be between 0 and 2^16 - 1');
    }

    const response = await this.command(`S2,${position},${pinIndex},${rate},${delay}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Configure stepper and servo modes.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SC}.
   * @param {number} paramIndex - The parameter index to set.
   * @param {number} paramValue - The value to set.
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async stepperAndServoModeConfigure(paramIndex, paramValue) {
    let command;

    switch (paramIndex) {
      case 1: { // Pen lift mechanism
        if (paramValue < 0 || paramValue > 2) {
          throw new Error('Parameter value must be between 0 and 2');
        }

        command = `SC,1,${paramValue}`;
        break;
      }
      case 2: { // Stepper signal control
        if (paramValue < 0 || paramValue > 2) {
          throw new Error('Parameter value must be between 0 and 2');
        }

        command = `SC,2,${paramValue}`;
        break;
      }
      case 4: { // Servo min
        if (paramValue < 1 || paramValue > 2 ** 16 - 1) {
          throw new Error('Parameter value must be between 1 and 2^16 - 1');
        }

        command = `SC,4,${paramValue}`;
        break;
      }
      case 5: { // Servo max
        if (paramValue < 1 || paramValue > 2 ** 16 - 1) {
          throw new Error('Parameter value must be between 1 and 2^16 - 1');
        }

        command = `SC,5,${paramValue}`;
        break;
      }
      case 8: { // Number of RC channels
        if (paramValue < 1 || paramValue > 24) {
          throw new Error('Parameter value must be between 1 and 24');
        }

        command = `SC,8,${paramValue}`;
        break;
      }
      case 9: { // S2 channel duration
        if (paramValue < 1 || paramValue > 6) {
          throw new Error('Parameter value must be between 1 and 6');
        }

        command = `SC,9,${paramValue}`;
        break;
      }
      case 10: { // Servo rate
        if (paramValue < 0 || paramValue > 2 ** 16 - 1) {
          throw new Error('Parameter value must be between 0 and 2^16 - 1');
        }

        command = `SC,10,${paramValue}`;
        break;
      }
      case 11: { // Servo rate up
        if (paramValue < 0 || paramValue > 2 ** 16 - 1) {
          throw new Error('Parameter value must be between 0 and 2^16 - 1');
        }

        command = `SC,11,${paramValue}`;
        break;
      }
      case 12: { // Servo rate down
        if (paramValue < 0 || paramValue > 2 ** 16 - 1) {
          throw new Error('Parameter value must be between 0 and 2^16 - 1');
        }

        command = `SC,12,${paramValue}`;
        break;
      }
      case 13: { // Alternate pause button function
        if (paramValue < 0 || paramValue > 1) {
          throw new Error('Parameter value must be between 0 and 1');
        }

        command = `SC,13,${paramValue}`;
        break;
      }
      default:
        throw new Error(`Parameter index ${paramIndex} not allowed`);
    }

    const response = await this.command(command);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Enable or disable and configure the engraver.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SE}.
   * @param {boolean} enableEngraver - Whether to enable the engraver.
   * @param {number} power - The power to use (0-1023).
   * @param {boolean} useMotionQueue - Whether to use the motion queue.
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async setEngraver(enableEngraver, power, useMotionQueue) {
    if (power < 0 || power > 1023) {
      throw new Error('Power must be between 0 and 1023');
    }

    const response = await this.command(`SE,${enableEngraver ? 1 : 0},${power},${useMotionQueue ? 1 : 0}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set the value of the layer variable.
   * @param {number} layerValue - The value to set.
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async setLayer(layerValue) {
    if (layerValue < 0 || layerValue > 127) {
      throw new Error('Layer value must be between 0 and 127');
    }

    const response = await this.command(`SL,${layerValue}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Move the stepper motors.
   * @param {number} duration - The duration of the move in milliseconds (1 to 2^24-1).
   * @param {number} m1Steps - The number of steps to move motor 1 (-(2^24-1) to 2^24-1).
   * @param {number} m2Steps - The number of steps to move motor 2 (-(2^24-1) to 2^24-1).
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async stepperMove(duration, m1Steps, m2Steps) {
    if (duration < 1 || duration > 2 ** 24 - 1) {
      throw new Error('Duration must be between 1 and 2^24 - 1');
    }

    if (m1Steps < -(2 ** 24) || m1Steps > 2 ** 24 - 1) {
      throw new Error('M1 steps must be between -2^24 and 2^24 - 1');
    }

    if (m2Steps < -(2 ** 24) || m2Steps > 2 ** 24 - 1) {
      throw new Error('M2 steps must be between -2^24 and 2^24 - 1');
    }

    const response = await this.command(`SM,${duration},${m1Steps},${m2Steps}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set the node count.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SN}.
   * @param {number} value - The node count (0-2^32).
   * @returns {Promise<void>} - Resolves when the node count has been set.
   */
  async setNodeCount(value) {
    if (value < 0 || value >= 2 ** 32) {
      throw new Error('Node count must be between 0 and 2^32');
    }

    const response = await this.command(`SN,${value}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set the pen state.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SP}.
   * @param {boolean} penDown - Whether the pen should be down (true) or up (false).
   * @param {number} [duration] - Duration in milliseconds
   * @param {number} [portBPin] - Port B pin number (0-7)
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async setPenState(penDown, duration, portBPin) {
    if (duration !== undefined && (duration < 1 || duration >= 2 ** 16)) {
      throw new Error('Duration must be between 1 and 2^16');
    }

    if (portBPin !== undefined && (portBPin < 0 || portBPin > 7)) {
      throw new Error('Port B pin must be between 0 and 7');
    }

    const penState = penDown ? PEN_DOWN : PEN_UP;

    let response;
    if (duration !== undefined && portBPin !== undefined) {
      response = await this.command(`SP,${penState},${duration},${portBPin}`);
    } else if (duration !== undefined) {
      response = await this.command(`SP,${penState},${duration}`);
    } else {
      response = await this.command(`SP,${penState}`);
    }

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set the servo power timeout.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SR}.
   * @param {number} duration - Duration in milliseconds (0-2^32).
   * @param {boolean} setPowerOn - Whether to set the power on (true) or off (false).
   * @returns {Promise<void>}
   */
  async setServoPowerTimeout(duration, setPowerOn) {
    if (duration < 0 || duration >= 2 ** 32) {
      throw new Error('Duration must be between 0 and 2^32');
    }

    const response = await this.command(`SR,${duration},${setPowerOn ? 1 : 0}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set this EBB's nickname.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#ST}.
   * @param {string} nickname
   * @returns {Promise<void>} - Resolves when the nickname has been set.
   */
  async setNickname(nickname) {
    if (nickname.length > 16) {
      throw new Error('Nickname must be 16 characters or less');
    }

    const response = await this.command(`ST,${nickname}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Turn on or off timed readings.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#T}.
   * @param {number} duration - Duration in milliseconds (1-2^16).
   * @param {boolean} digitalMode - Whether to use digital mode (true) or analog mode (false).
   * @returns {Promise<void>} - Resolves when the command has been acknowledged.
   */
  async timedRead(duration, digitalMode) {
    if (duration < 1 || duration >= 2 ** 16) {
      throw new Error('Duration must be between 1 and 2^16');
    }

    const mode = digitalMode ? MODE_DIGITAL : MODE_ANALOG;
    const response = await this.command(`T,${duration},${mode}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Toggle the state of the pen up or down.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#TP}.
   * @param {number} [duration] - Duration in milliseconds
   * @returns {Promise<void>} - Resolves when the pen state has been toggled.
   */
  async togglePen(duration) {
    if (duration) {
      if (duration < 1 || duration >= 2 ** 16) {
        throw new Error('Duration must be between 0 and 2^16');
      }

      await this.command(`TP,${Math.floor(duration)}`);
      return;
    }

    const response = await this.command('TP');

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Query the node count.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QN}.
   * @returns {Promise<number>} - Resolves to the node count.
   */
  async queryNodeCount() {
    const response = await this.command('QN', 2);

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [nodeCount, status] = response.split('\r\n');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    return parseInt(nodeCount, 10);
  }

  /**
   * Query the EBB version.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#V}.
   * @returns {Promise<string>} - Resolves to the EBB version string.
   */
  queryVersion() {
    return this.command('V');
  }

  /**
   * Stepper move, for mixed-axis geometries.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#XM}.
   * @param {number} durationMs - Duration of the move in milliseconds.
   * @param {number} stepsA
   * @param {number} stepsB
   * @returns {Promise<void>} - Resolves when the command is acknowledged.
   */
  async stepperMoveMixedAxis(durationMs, stepsA, stepsB) {
    if (durationMs < 1 || durationMs >= 2 ** 24) {
      throw new Error('Duration must be between 1 and 2^24 milliseconds');
    }

    if (stepsA <= -(2 ** 24) || stepsA >= 2 ** 24) {
      throw new Error('Steps A must be between 0 and 2^24');
    }

    if (stepsB < -(2 ** 24) || stepsB >= 2 ** 24) {
      throw new Error('Steps B must be between 0 and 2^24');
    }

    const response = await this.command(`XM,${Math.floor(durationMs)},${Math.floor(stepsA)},${Math.floor(stepsB)}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }
}

module.exports = {
  EiBotBoard,

  PEN_UP,
  PEN_DOWN,

  MOTOR_DISABLE,
  MOTOR_STEP_DIV16,
  MOTOR_STEP_DIV8,
  MOTOR_STEP_DIV4,
  MOTOR_STEP_DIV2,
  MOTOR_STEP_DIV1,
};
