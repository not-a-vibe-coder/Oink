/**
 * Builds the Oink Android APK: a Trusted Web Activity around the deployed PWA. The APK holds no
 * wallet code or keys of its own — it opens the site in Chrome, so custody, Bell and Mobile
 * Wallet Adapter behave exactly as on the web.
 *
 * Usage (from twa/):
 *   OINK_TWA_HOST=app.example.com bun build-apk.ts [--create-keystore]
 *
 * Environment:
 *   OINK_TWA_HOST          required; the production host (no scheme). Rebuild when it changes.
 *   OINK_TWA_PACKAGE       Android application id (default app.oink.wallet). Never change it
 *                          after publishing: the store treats a new id as a new app.
 *   OINK_TWA_VERSION_CODE  integer, must increase on every store upload (default 1)
 *   OINK_TWA_VERSION_NAME  display version (default 1.0.0)
 *   OINK_ICON_ORIGIN       where to fetch icons and the web manifest during the build
 *                          (default https://<host>); point it at a local production server
 *                          before the site is live.
 *   OINK_KEYSTORE          signing keystore (default ~/.oink/android/oink-release.keystore)
 *   OINK_KEYSTORE_PASSWORD required. PKCS12 keystores use one password for store and key. It
 *                          is handed to keytool/apksigner by environment variable name only,
 *                          never as a command-line argument, and redacted from any error.
 *   ANDROID_HOME           Android SDK (default ~/Library/Android/sdk)
 *   OINK_JDK_PATH          JDK 17 bundle (default: `/usr/libexec/java_home -v 17`, minus Contents/Home)
 *
 * Outputs: twa/dist/oink-<host>-<versionName>.apk and public/.well-known/assetlinks.json
 * (package + SHA-256 of the signing certificate), which must be deployed at
 * https://<host>/.well-known/assetlinks.json for Chrome to drop the URL bar.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BUILD_TOOLS_VERSION } from "@bubblewrap/core/dist/lib/androidSdk/AndroidSdkTools";
import {
  AndroidSdkTools,
  Config,
  ConsoleLog,
  DigitalAssetLinks,
  GradleWrapper,
  JdkHelper,
  TwaGenerator,
  TwaManifest,
} from "@bubblewrap/core";

const root = resolve(import.meta.dir, "..");
const log = new ConsoleLog("oink-twa");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}.`);
  return value;
}

const host = required("OINK_TWA_HOST").toLowerCase();
if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host))
  throw new Error("OINK_TWA_HOST must be a bare host name such as app.example.com.");
const packageId = process.env.OINK_TWA_PACKAGE ?? "app.oink.wallet";
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId))
  throw new Error("OINK_TWA_PACKAGE must be a Java-style package id.");
const versionCode = Number(process.env.OINK_TWA_VERSION_CODE ?? "1");
if (!Number.isSafeInteger(versionCode) || versionCode < 1)
  throw new Error("OINK_TWA_VERSION_CODE must be a positive integer.");
const versionName = process.env.OINK_TWA_VERSION_NAME ?? "1.0.0";
const iconOrigin = (process.env.OINK_ICON_ORIGIN ?? `https://${host}`).replace(/\/+$/, "");
const keystore =
  process.env.OINK_KEYSTORE ?? join(homedir(), ".oink/android/oink-release.keystore");
const alias = "oink";
const password = required("OINK_KEYSTORE_PASSWORD");
if (password.length < 16) throw new Error("OINK_KEYSTORE_PASSWORD must be at least 16 characters.");
const sdkPath = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const jdkPath =
  process.env.OINK_JDK_PATH ??
  execFileSync("/usr/libexec/java_home", ["-v", "17"], { encoding: "utf8" })
    .trim()
    .replace(/\/Contents\/Home\/?$/, "");

if (keystore.startsWith(root))
  throw new Error("Keep the keystore outside the repository (see twa/README.md).");

const config = new Config(jdkPath, sdkPath);
const jdk = new JdkHelper(process, config);
// `AndroidSdkTools.create` only accepts Bubblewrap's own legacy SDK layout (sdkmanager at the
// SDK root). We use Google's standard layout (cmdline-tools/latest), so construct directly and
// check the one thing the build needs: the build-tools version Bubblewrap pins.
const sdk = new AndroidSdkTools(process, config, jdk, log);
if (!(await sdk.checkBuildTools()))
  throw new Error(
    `Install build-tools ${BUILD_TOOLS_VERSION}: sdkmanager "build-tools;${BUILD_TOOLS_VERSION}"`,
  );
const javaBin = (tool: string) => join(jdk.getJavaHome(), "bin", tool);
const env = { ...process.env, JAVA_HOME: jdk.getJavaHome() };
// Every secret-bearing tool reads the password from OINK_KEYSTORE_PASSWORD by name.
function run(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String((error as { stderr?: string }).stderr ?? "")
      .split(password)
      .join("[REDACTED]");
    throw new Error(`${command.split("/").pop()} failed: ${detail.trim().slice(0, 500)}`);
  }
}

if (!existsSync(keystore)) {
  if (!process.argv.includes("--create-keystore"))
    throw new Error(`No keystore at ${keystore}. Re-run with --create-keystore to make one.`);
  mkdirSync(dirname(keystore), { recursive: true, mode: 0o700 });
  run(javaBin("keytool"), [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-alias",
    alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "4096",
    "-validity",
    "10000",
    "-dname",
    "CN=Oink, OU=Mobile, O=Oink, C=US",
    "-storepass:env",
    "OINK_KEYSTORE_PASSWORD",
  ]);
  chmodSync(keystore, 0o600);
  log.info(`Created keystore at ${keystore}. Back it up: losing it means a new app listing.`);
}
const listing = run(javaBin("keytool"), [
  "-list",
  "-v",
  "-keystore",
  keystore,
  "-alias",
  alias,
  "-storepass:env",
  "OINK_KEYSTORE_PASSWORD",
]);
const sha256 = /SHA256:\s*([0-9A-F:]{95})/.exec(listing)?.[1];
if (!sha256) throw new Error("Could not read the signing certificate fingerprint.");

// Built from the same web manifest the PWA ships, so names, colours and start URL agree.
const webManifest = JSON.parse(readFileSync(join(root, "public/manifest.webmanifest"), "utf8"));
const twaManifest = TwaManifest.fromWebManifestJson(
  new URL(`https://${host}/manifest.webmanifest`),
  webManifest,
);
Object.assign(twaManifest, {
  packageId,
  host,
  launcherName: "Oink",
  name: "Oink",
  appVersionCode: versionCode,
  appVersionName: versionName,
  iconUrl: `${iconOrigin}/icons/icon-512.png`,
  maskableIconUrl: `${iconOrigin}/icons/icon-maskable-512.png`,
  monochromeIconUrl: undefined,
  // Bubblewrap downloads the manifest to embed it; fetch it from the same build-time origin.
  webManifestUrl: new URL(`${iconOrigin}/manifest.webmanifest`),
  // Push is delivered by Chrome to the PWA; delegation keeps it in the TWA's notifications.
  enableNotifications: true,
  fallbackType: "customtabs",
  signingKey: { path: keystore, alias },
  fingerprints: [{ name: "release", value: sha256 }],
});

const project = join(import.meta.dir, "build", host);
rmSync(project, { recursive: true, force: true });
mkdirSync(project, { recursive: true });
await new TwaGenerator().createTwaProject(project, twaManifest, log);
await twaManifest.saveToFile(join(project, "twa-manifest.json"));

await new GradleWrapper(process, sdk, project).assembleRelease();
const unsigned = join(project, "app/build/outputs/apk/release/app-release-unsigned.apk");
const aligned = join(project, "app-release-aligned.apk");
const dist = join(import.meta.dir, "dist");
mkdirSync(dist, { recursive: true });
const apk = join(dist, `oink-${host}-${versionName}.apk`);
await sdk.zipalign(unsigned, aligned);
const apksigner = join(sdkPath, "build-tools", BUILD_TOOLS_VERSION, "apksigner");
run(apksigner, [
  "sign",
  "--ks",
  keystore,
  "--ks-key-alias",
  alias,
  "--ks-pass",
  "env:OINK_KEYSTORE_PASSWORD",
  "--out",
  apk,
  aligned,
]);
run(apksigner, ["verify", apk]);

const assetLinks = join(root, "public/.well-known/assetlinks.json");
mkdirSync(dirname(assetLinks), { recursive: true });
writeFileSync(assetLinks, `${DigitalAssetLinks.generateAssetLinks(packageId, sha256)}\n`);
copyFileSync(join(project, "twa-manifest.json"), join(dist, `twa-manifest-${host}.json`));

log.info(`APK: ${apk}`);
log.info(`assetlinks.json written for ${packageId} (${sha256}). Deploy it with the site.`);
