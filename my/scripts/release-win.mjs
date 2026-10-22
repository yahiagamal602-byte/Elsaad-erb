import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconPath = resolve(projectDirectory, 'build', 'icon.ico');
const packageConfig = JSON.parse(readFileSync(join(projectDirectory, 'package.json'), 'utf8'));
const certificatePath = process.env.CSC_LINK;
const certificatePassword = process.env.CSC_KEY_PASSWORD;

function fail(message) {
  console.error(`Windows release failed: ${message}`);
  process.exit(1);
}

if (!existsSync(iconPath)) fail('the Windows application icon build/icon.ico is missing.');
const iconHeader = readFileSync(iconPath);
if (iconHeader.length < 6 || iconHeader.readUInt16LE(0) !== 0 || iconHeader.readUInt16LE(2) !== 1
  || iconHeader.readUInt16LE(4) < 5) {
  fail('build/icon.ico is not a valid multi-resolution Windows icon.');
}
const iconCount = iconHeader.readUInt16LE(4);
for (let index = 0; index < iconCount; index += 1) {
  const entryOffset = 6 + index * 16;
  if (entryOffset + 16 > iconHeader.length) fail('build/icon.ico contains an incomplete image directory.');
  const imageLength = iconHeader.readUInt32LE(entryOffset + 8);
  const imageOffset = iconHeader.readUInt32LE(entryOffset + 12);
  if (imageOffset + imageLength > iconHeader.length || imageLength < 24
    || iconHeader.readUInt32LE(imageOffset) !== 0x474e5089
    || iconHeader.readUInt32LE(imageOffset + 12) !== 0x52444849) {
    fail('build/icon.ico contains an invalid PNG image frame.');
  }
}
const windowsConfig = packageConfig.build?.win;
const nsisConfig = packageConfig.build?.nsis;
if (packageConfig.author !== 'Mohanda Saad' || !packageConfig.description || !packageConfig.version
  || packageConfig.build?.productName !== 'Elsaad ERP' || !packageConfig.build?.appId
  || windowsConfig?.icon !== 'build/icon.ico' || windowsConfig?.forceCodeSigning !== true
  || !windowsConfig?.publisherName || nsisConfig?.installerIcon !== 'build/icon.ico'
  || nsisConfig?.uninstallerIcon !== 'build/icon.ico' || nsisConfig?.installerHeaderIcon !== 'build/icon.ico'
  || nsisConfig?.shortcutName !== 'Elsaad ERP' || nsisConfig?.createDesktopShortcut !== true
  || nsisConfig?.createStartMenuShortcut !== true) {
  fail('Windows product metadata, icon, or shortcut configuration is incomplete.');
}
if (process.platform !== 'win32') fail('signed Windows releases must be built on Windows.');
if (!certificatePath || !isAbsolute(certificatePath)) {
  fail('CSC_LINK must point to an external PFX/P12 certificate file using an absolute path.');
}
if (!['.pfx', '.p12'].includes(certificatePath.slice(certificatePath.lastIndexOf('.')).toLowerCase())) {
  fail('CSC_LINK must reference a PFX/P12 certificate file.');
}
if (!existsSync(certificatePath) || !statSync(certificatePath).isFile()) {
  fail('the certificate file specified by CSC_LINK is unavailable.');
}
let resolvedCertificatePath;
try {
  resolvedCertificatePath = realpathSync(certificatePath);
} catch {
  fail('the certificate file specified by CSC_LINK could not be resolved.');
}
const relativeCertificatePath = relative(projectDirectory, resolvedCertificatePath);
const certificateIsInsideRepository = relativeCertificatePath === ''
  || (!isAbsolute(relativeCertificatePath)
    && relativeCertificatePath !== '..'
    && !relativeCertificatePath.startsWith(`..${sep}`));
if (certificateIsInsideRepository) {
  fail('the signing certificate must be stored outside the project repository.');
}
if (!certificatePassword) fail('CSC_KEY_PASSWORD is required and must be supplied as an environment secret.');

const outputName = `signed-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '')}-${process.pid}`;
const outputDirectory = resolve(projectDirectory, 'release', outputName);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectDirectory,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`could not start ${command}.`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status ?? 'unknown'}.`);
}

run('npm', ['run', 'build']);
run('npx', [
  'electron-builder',
  '--win',
  'nsis',
  `--config.directories.output=${relative(projectDirectory, outputDirectory)}`,
]);
run('powershell.exe', [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  resolve(projectDirectory, 'scripts', 'verify-windows-signatures.ps1'),
  '-ReleaseDirectory',
  outputDirectory,
]);

console.log(`Signed Windows release verified: ${outputDirectory}`);
