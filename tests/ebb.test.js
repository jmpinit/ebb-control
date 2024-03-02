jest.mock('../src/web-serialport');

const SerialPort = require('../src/web-serialport');
const { EiBotBoard, MOTOR_STEP_DIV4, MOTOR_STEP_DIV16 } = require('../src/ebb');

afterEach(() => {
  SerialPort.prototype.print.mockRestore();
});

function getEbb() {
  const ebb = new EiBotBoard();
  ebb.connect();

  return ebb;
}

function expectAndEmit(expectedStr, emitStr) {
  jest.spyOn(SerialPort.prototype, 'print')
    .mockImplementation(async function mockPrint(str) {
      if (expectedStr !== undefined) {
        expect(expectedStr).toEqual(str);
      }

      if (emitStr !== undefined) {
        if (typeof emitStr === 'string') {
          this.emit('line', emitStr);
        } else if (Array.isArray(emitStr)) {
          emitStr.forEach((s) => this.emit('line', s));
        } else {
          throw new Error('Unexpected emit string type');
        }
      }
    });
}

test('Getting an analog value', async () => {
  const ebb = getEbb();

  // Example from docs

  expectAndEmit(undefined, 'A,00:0713,02:0241,05:0089,09:1004');

  const values = await ebb.analogValueGet();

  expect(values).toEqual({
    0: 713,
    2: 241,
    5: 89,
    9: 1004,
  });

  // One channel receiving zero
  expectAndEmit(undefined, 'A,00:0000');
  const values2 = await ebb.analogValueGet();
  expect(values2).toEqual({ 0: 0 });

  // Receiving max values
  expectAndEmit(undefined, 'A,00:1023');
  const values3 = await ebb.analogValueGet();
  expect(values3).toEqual({ 0: 1023 });
});

test('Configuring the analog channels', async () => {
  const ebb = getEbb();
  expectAndEmit('AC,0,1\r', 'OK');
  await ebb.analogConfigure(0, true);
});

test('Entering the bootloader', async () => {
  const ebb = getEbb();
  expectAndEmit('BL\r', 'OK');
  await ebb.enterBootloader();
});

test('Configuring pin directions', async () => {
  const ebb = getEbb();
  expectAndEmit('C,0,1,2,3,4\r', 'OK');
  await ebb.configurePinDirections(0, 1, 2, 3, 4);
});

test('Zero the motor step positions', async () => {
  const ebb = getEbb();
  expectAndEmit('CS\r', 'OK');
  await ebb.clearStepPosition();
});

test('Configure user interface options', async () => {
  const ebb = getEbb();

  let commandIndex = 0;
  jest.spyOn(SerialPort.prototype, 'print')
    .mockImplementation(async function mockPrint(str) {
      switch (commandIndex) {
        case 0:
          expect(str).toEqual('CU,1,1\r');
          break;
        case 1:
          expect(str).toEqual('CU,2,1\r');
          break;
        case 2:
          expect(str).toEqual('CU,3,0\r');
          break;
        default:
          throw new Error('Unexpected number of commands');
      }

      commandIndex += 1;

      this.emit('line', 'OK');
    });

  await ebb.configureUserOptions();
});

test('Enable stepper motors and set step mode', async () => {
  const ebb = getEbb();
  expectAndEmit('EM,1,1\r', 'OK');
  await ebb.enableMotors(MOTOR_STEP_DIV16, MOTOR_STEP_DIV16);
});

test('Emergency stop', async () => {
  const ebb = getEbb();
  expectAndEmit('ES,1\r', [
    '1,13,37,42,57',
    'OK',
  ]);
  const stopInfo = await ebb.emergencyStop(true);

  expect(stopInfo).toEqual({
    interrupted: true,
    fifoSteps: [13, 37],
    stepsRemaining: [42, 57],
  });
});

test('Absolute move', async () => {
  const ebb = getEbb();
  expectAndEmit('HM,1337,1000,2000\r', 'OK');
  await ebb.absoluteMove(1337, 1000, 2000);
});

test('Get input pin states', async () => {
  const ebb = getEbb();
  expectAndEmit('I\r', 'I,128,255,130,000,007');
  const portValues = await ebb.getInput();
  expect(portValues).toEqual([128, 255, 130, 0, 7]);
});

test('Low level step-limited moves', async () => {
  const ebb = getEbb();
  expectAndEmit('LM,3865471,60,1732,0,0,0,0\r', 'OK');

  await ebb.lowLevelMove(3865471, 60, 1732, false, 0, 0, 0, false);
});

test('Low level time-limited moves', async () => {
  const ebb = getEbb();
  expectAndEmit('LT,10169,3865471,1732,0,0,3\r', 'OK');

  await ebb.lowLevelMoveTimeLimited(10169, 3865471, 1732, true, 0, 0, true);
});

test('Memory read', async () => {
  const ebb = getEbb();
  expectAndEmit('MR,1337\r', 'MR,1234');
  const value = await ebb.memoryRead(1337);
  expect(value).toEqual(1234);

  await expect(() => ebb.memoryRead(-1)).rejects.toThrow();
  await expect(() => ebb.memoryRead(4096)).rejects.toThrow();
});

test('Memory write', async () => {
  const ebb = getEbb();
  expectAndEmit('MW,1337,123\r', 'OK');
  await ebb.memoryWrite(1337, 123);

  await expect(() => ebb.memoryWrite(-1, 0)).rejects.toThrow();
  await expect(() => ebb.memoryWrite(4096, 0)).rejects.toThrow();
  await expect(() => ebb.memoryWrite(0, -1)).rejects.toThrow();
  await expect(() => ebb.memoryWrite(0, 256)).rejects.toThrow();
});

test('Node count decrement', async () => {
  const ebb = getEbb();
  expectAndEmit('ND\r', 'OK');
  await ebb.nodeCountDecrement();
});

test('Node count increment', async () => {
  const ebb = getEbb();
  expectAndEmit('NI\r', 'OK');
  await ebb.nodeCountIncrement();
});

test('Set digital outputs', async () => {
  const ebb = getEbb();
  expectAndEmit('O,1,2,3,4,5\r', 'OK');
  await ebb.setOutputs(1, 2, 3, 4, 5);
});

test('Configure pulse generator parameters', async () => {
  const ebb = getEbb();
  expectAndEmit('PC,1,2,3,4,5,6,7,8\r', 'OK');
  await ebb.pulseConfigure(1, 2, 3, 4, 5, 6, 7, 8);
});

test('Set pin directions', async () => {
  const ebb = getEbb();
  expectAndEmit('PD,A,2,0\r', 'OK');
  await ebb.setPinDirection('A', 2, true);

  await expect(() => ebb.setPinDirection('Z', 0, true)).rejects.toThrow();
  await expect(() => ebb.setPinDirection('A', -1, true)).rejects.toThrow();
  await expect(() => ebb.setPinDirection('A', 8, true)).rejects.toThrow();
});

test('Start and stop pulse generation', async () => {
  const ebb = getEbb();
  expectAndEmit('PG,1\r', 'OK');
  await ebb.pulseGo(true);
  expectAndEmit('PG,0\r', 'OK');
  await ebb.pulseGo(false);
});

test('Get pin state', async () => {
  const ebb = getEbb();
  expectAndEmit('PI,A,0\r', 'PI,1');
  const state = await ebb.pinInput('A', 0);
  expect(state).toEqual(true);

  await expect(() => ebb.pinInput('Z', 0)).rejects.toThrow();
  await expect(() => ebb.pinInput('A', -1)).rejects.toThrow();
  await expect(() => ebb.pinInput('A', 8)).rejects.toThrow();
});

test('Set pin state', async () => {
  const ebb = getEbb();
  expectAndEmit('PO,A,0,1\r', 'OK');
  await ebb.pinOutput('A', 0, true);

  await expect(() => ebb.pinOutput('Z', 0, true)).rejects.toThrow();
  await expect(() => ebb.pinOutput('A', -1, true)).rejects.toThrow();
  await expect(() => ebb.pinOutput('A', 8, true)).rejects.toThrow();
});

test('Query whether the button was pressed', async () => {
  const ebb = getEbb();
  expectAndEmit('QB\r', ['1', 'OK']);
  const pressed = await ebb.queryButton();
  expect(pressed).toEqual(true);
});

test('Query the max current setting and power voltage', async () => {
  const ebb = getEbb();
  expectAndEmit('QC\r', ['1023,1023', 'OK']);
  const info = await ebb.queryCurrent();
  expect(info).toEqual({
    maxCurrent: 3.3 / 1.76,
    powerVoltage: 3.3 * 9.2 + 0.3,
  });
});

test('Query the current motor configuration', async () => {
  const ebb = getEbb();
  expectAndEmit('QE\r', ['4,16', 'OK']);
  const [m1Mode, m2Mode] = await ebb.queryMotorConfig();
  expect(m1Mode).toEqual(MOTOR_STEP_DIV4);
  expect(m2Mode).toEqual(MOTOR_STEP_DIV16);
});

test('General query', async () => {
  const ebb = getEbb();
  expectAndEmit('QG\r', '3E');
  const status = await ebb.queryGeneral();
  expect(status).toEqual({
    pinRB5: false,
    pinRB2: false,
    buttonPrg: true,
    penDown: true,
    commandExecuting: true,
    motor1Moving: true,
    motor2Moving: true,
    fifoEmpty: true,
  });
});

test('Query the value of the current layer', async () => {
  const ebb = getEbb();
  expectAndEmit('QL\r', ['1', 'OK']);
  const layer = await ebb.queryLayer();
  expect(layer).toEqual(1);
});

test('Query the status of the motors and motion FIFO', async () => {
  const ebb = getEbb();
  expectAndEmit('QM\r', 'QM,1,1,1,1');
  const motorStatus = await ebb.queryMotors();
  expect(motorStatus).toEqual({
    executingMotion: true,
    motorMoving: [true, true],
    fifoEmpty: false,
  });
});

test('Query the pen state', async () => {
  const ebb = getEbb();
  expectAndEmit('QP\r', ['1', 'OK']); // 1 = pen is up
  const penDown = await ebb.queryPen();
  expect(penDown).toEqual(false);
});

test('Query the servo power status', async () => {
  const ebb = getEbb();
  expectAndEmit('QR\r', ['1', 'OK']);
  const powered = await ebb.queryServoPower();
  expect(powered).toEqual(true);
});

test('Query step position', async () => {
  const ebb = getEbb();
  expectAndEmit('QS\r', ['1421,-429', 'OK']);
  const position = await ebb.queryStepPosition();
  expect(position).toEqual([1421, -429]);
});

test('Query nickname', async () => {
  const ebb = getEbb();
  expectAndEmit('QT\r', ['MyCoolRobot', 'OK']);
  const nickname = await ebb.queryNickname();
  expect(nickname).toEqual('MyCoolRobot');
});

test('Reboot', async () => {
  const ebb = getEbb();
  expectAndEmit('RB\r', 'OK');
  await ebb.reboot();
});

test('Reset', async () => {
  const ebb = getEbb();
  expectAndEmit('R\r', 'OK');
  await ebb.reset();
});

test('General RC servo output', async () => {
  const ebb = getEbb();
  expectAndEmit('S2,12000,3,5000,1337\r', 'OK');
  await ebb.servoOutput(12000, 3, 5000, 1337);
});

test('Stepper and servo mode configure', async () => {
  const ebb = getEbb();
  expectAndEmit('SC,1,2\r', 'OK');
  await ebb.stepperAndServoModeConfigure(1, 2);
});

test('Set engraver mode', async () => {
  const ebb = getEbb();
  expectAndEmit('SE,1,123,1\r', 'OK');
  await ebb.setEngraver(true, 123, true);
});

test('Set the value of the layer variable', async () => {
  const ebb = getEbb();
  expectAndEmit('SL,125\r', 'OK');
  await ebb.setLayer(125);
});

test('Moving the stepper motors', async () => {
  const ebb = getEbb();
  expectAndEmit('SM,1337,100,200\r', 'OK');
  await ebb.stepperMove(1337, 100, 200);
});

test('Set node count', async () => {
  const ebb = getEbb();
  expectAndEmit('SN,123\r', 'OK');
  await ebb.setNodeCount(123);
});

test('Set the pen state', async () => {
  const ebb = getEbb();
  expectAndEmit('SP,0,1000,0\r', 'OK');
  await ebb.setPenState(true, 1000, 0);
});

test('Set RC servo power timeout value', async () => {
  const ebb = getEbb();
  expectAndEmit('SR,1000,1\r', 'OK');
  await ebb.setServoPowerTimeout(1000, true);
});

test('Set the nickname', async () => {
  const ebb = getEbb();
  expectAndEmit('ST,MyCoolRobot\r', 'OK');
  await ebb.setNickname('MyCoolRobot');
});

test('Timed reading', async () => {
  const ebb = getEbb();
  expectAndEmit('T,1000,0\r', 'OK');
  await ebb.timedRead(1000, true);
});

test('Toggle pen', async () => {
  const ebb = getEbb();
  expectAndEmit('TP,5000\r', 'OK');
  await ebb.togglePen(5000);
});

test('Query node count', async () => {
  const ebb = getEbb();
  expectAndEmit('QN\r', ['123', 'OK']);
  const nodeCount = await ebb.queryNodeCount();
  expect(nodeCount).toEqual(123);
});

test('Query version', async () => {
  const ebb = getEbb();
  expectAndEmit('V\r', ['EBBv13', 'OK']);
  const version = await ebb.queryVersion();
  expect(version).toEqual('EBBv13');
});

test('Stepper move mixed axis', async () => {
  const ebb = getEbb();
  expectAndEmit('XM,1337,100,200\r', 'OK');
  await ebb.stepperMoveMixedAxis(1337, 100, 200);
});
