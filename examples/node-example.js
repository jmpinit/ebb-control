const { EiBotBoard, SerialPort, MOTOR_STEP_DIV16 } = require('../src');

if (process.argv.length !== 3) {
  console.log('Usage: node node-example.js <serial port path>');
  process.exit(1);
}

const serialPortPath = process.argv[2];
const serialPort = new SerialPort(serialPortPath, 115200);
const ebb = new EiBotBoard(serialPort);

function wait(ms) {
  return new Promise((fulfill) => {
    setTimeout(() => fulfill(), ms);
  });
}

(async () => {
  await ebb.connect();
  console.log('Connected to EBB. Drawing a square.');

  await ebb.setPenState(true);
  await wait(1000);

  const moveDuration = 500;

  await ebb.enableMotors(MOTOR_STEP_DIV16, MOTOR_STEP_DIV16);
  await ebb.stepperMoveMixedAxis(moveDuration, 500, 0);
  await wait(moveDuration);

  await ebb.stepperMoveMixedAxis(moveDuration, 0, 500);
  await wait(moveDuration);

  await ebb.stepperMoveMixedAxis(moveDuration, -500, 0);
  await wait(moveDuration);

  await ebb.stepperMoveMixedAxis(moveDuration, 0, -500);
  await wait(moveDuration);

  await ebb.setPenState(false);

  await serialPort.disconnect();
})();
