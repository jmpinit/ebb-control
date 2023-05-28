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

  analogValueGet() {
    // EBB returns 10 bit values for each channel 0-1023 and 0V to 3.3V

    // Only channels that are enabled will be returned, ordered by their channel #
    // Least to greatest

    // Channel number padded to 2 characters
    // ADC value is padded to 4 characters

    // Example: A,00:0713,02:0241,05:0089:09:1004<CR><NL>

    // TODO: implement
    throw new Error('Not implemented');
  }

  /**
   * Enter bootloader mode.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#BL}.
   * @returns {Promise<void>} - Resolves after the EBB has been disconnected
   */
  async enterBootloader() {
    // The EBB should disconnect in response to this command
    // and reconnect as a different port

    await this.command('BL');
    return this.port.disconnect();
  }

  configurePinDirections() {
    // Useful to set pin directions for all pins at once

    // Sets the values of the TRIS registers which control pin direction
    // 0 means output
    // 1 means input

    // TODO: implement
    throw new Error('Not implemented');
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
   * @param m1Mode - Step mode for motor 1.
   * @param m2Mode - Step mode for motor 2.
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

    const [info, status] = response.split('\n\r');

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

  absoluteMove() {
    // Move to an absolute position relative to home
    // Only meant for "utility" moves rather than smooth/fast motion

    // TODO: implement
    throw new Error('Not implemented');
  }

  getInput() {
    // Reads all pins as digital inputs

    // TODO: implement
    throw new Error('Not implemented');
  }

  lowLevelMove() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  lowLevelMoveTimeLimited() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  memoryRead() {
    // Address 0 to 4095

    // TODO: implement
    throw new Error('Not implemented');
  }

  memoryWrite() {
    // TODO: implement
    throw new Error('Not implemented');
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

  setOutput() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  pulseConfigure() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  pinDirection() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  pulseGo() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  pinInput() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  pinOutput() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  queryButton() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  queryCurrent() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  /**
   * Query the current motor configuration.
   * Firmware versions v2.8.0 and newer.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#QE}.
   * @returns {Promise<Array<number>>} - Resolves with an array of step modes for each motor.
   */
  async queryMotorConfig() {
    const response = await this.command('QE');

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [motorStatus, status] = response.split('\n\r');

    if (status !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [m1Mode, m2Mode] = motorStatus.split(',');

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

  queryGeneral() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  queryLayer() {
    // TODO: implement
    throw new Error('Not implemented');
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
      fifoEmpty: parseInt(fifoStatus, 10) > 0,
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

  queryServoPower() {
    // TODO: implement
    throw new Error('Not implemented');
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

  servoOutput() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  stepperAndServoModeConfigure() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  setEngraver() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  setLayer() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  stepperMove() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  /**
   * Set the node count.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SN}.
   * @param value - The node count (0-2^32).
   * @returns {Promise<void>} - Resolves when the node count has been set.
   */
  setNodeCount(value) {
    if (value < 0 || value >= 2 ** 32) {
      throw new Error('Node count must be between 0 and 2^32');
    }

    const response = this.command(`SN,${value}`);

    if (response !== 'OK') {
      throw new Error(`Unexpected response: ${response}`);
    }
  }

  /**
   * Set the pen state.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#SP}.
   * @param {boolean} penDown
   * @param {number} [duration] - Duration in milliseconds
   * @param {number} [portBPin] - Port B pin number (0-7)
   */
  setPenState(penDown, duration, portBPin) {
    if (duration !== undefined && (duration < 1 || duration >= 2 ** 16)) {
      throw new Error('Duration must be between 1 and 2^16');
    }

    if (portBPin !== undefined && (portBPin < 0 || portBPin > 7)) {
      throw new Error('Port B pin must be between 0 and 7');
    }

    const penState = penDown ? PEN_DOWN : PEN_UP;

    if (duration && portBPin) {
      return this.command(`SP,${penState},${duration},${portBPin}`);
    }

    if (duration) {
      return this.command(`SP,${penState},${duration}`);
    }

    return this.command(`SP,${penState}`);
  }

  setServoPowerTimeout() {
    // TODO: implement
    throw new Error('Not implemented');
  }

  /**
   * Set this EBB's nickname.
   * See {@link https://evil-mad.github.io/EggBot/ebb.html#ST}.
   * @param nickname
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

  timedReading() {
    // TODO: implement
    throw new Error('Not implemented');
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
    const response = await this.command('QN');

    if (response.indexOf('\r\n') === -1) {
      throw new Error(`Unexpected response: ${response}`);
    }

    const [nodeCount, status] = response.split('\n\r');

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
   * @param durationMs - Duration of the move in milliseconds.
   * @param stepsA
   * @param stepsB
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
