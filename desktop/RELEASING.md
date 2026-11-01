# Releasing the desktop app

This is how a new version of Raven desktop gets to people, and how to turn on code signing once the accounts exist.

## Cutting a release

1. Check that `## [Unreleased]` in `CHANGELOG.md` says what changed.
2. Run `bun run bump patch` (or `minor`, `major`). It moves the Unreleased notes under the new version, updates `package.json`, commits and makes the tag `vX.Y.Z`. It doesn't push.
3. Push the commit and the tag together: `git push --atomic origin main vX.Y.Z`. With `--atomic`, either both land or neither does.
4. The tag starts the **Desktop** workflow. It builds on Windows, macOS and Linux, signs when the keys are set (see below), and checks every build. When all three pass, the `draft release` job makes a **draft** release for the tag. Its notes are the version's CHANGELOG section, and it has every file and one `SHA256SUMS.txt`.
5. Open the draft on GitHub (Releases). Check the files are there and edit the notes if you want.
6. Click **Publish release**. Leave **Set as the latest release** ticked: the updater only looks at the latest release.

Nothing publishes by itself. Until you click Publish, nobody gets the update.

If the release job fails, or you want to build again, delete the draft first. The job stops if a release for the tag already exists, so it never makes two.

### What the draft has

| File | For |
| --- | --- |
| `Raven-X.Y.Z-win-x64.exe` | Windows installer |
| `Raven-X.Y.Z-mac-arm64.dmg`, `Raven-X.Y.Z-mac-x64.dmg` | macOS installers |
| `Raven-X.Y.Z-mac-arm64.zip`, `Raven-X.Y.Z-mac-x64.zip` | What the macOS updater installs from |
| `Raven-X.Y.Z-linux-x86_64.AppImage`, `Raven-X.Y.Z-linux-amd64.deb` | Linux |
| `latest.yml`, `latest-mac.yml`, `latest-linux.yml` | What the updater reads: the newest version, its files and their sha512 |
| `*.blockmap` | Lets the updater download only the parts that changed |
| `SHA256SUMS.txt` | Checksums of every file above |

Don't rename the files. `latest*.yml` names them exactly.

## How the app updates

The app checks the latest published release 30 seconds after it starts, every 6 hours, and when you pick **Check for updates…** (File menu, the Raven menu on macOS, or the tray menu). Drafts are invisible to it. Dev and preview runs never check.

| Build | What happens |
| --- | --- |
| Windows (`.exe`) | Downloads in the background, then asks to restart. If you pick Later, it installs when you next quit Raven. |
| Linux AppImage | The same. The new AppImage replaces the old file. |
| macOS, signed | The same, through Squirrel.Mac (it needs the `.zip`). |
| macOS, not signed | Says a new version is out and opens its release page. Squirrel.Mac only installs updates signed with the same Developer ID, so you install the new `.dmg` yourself. |
| Linux `.deb` | Says a new version is out and opens its release page. Installing a `.deb` needs root. |

The installer only starts once Raven has closed its windows and stopped its server. On an update, the Windows installer closes every Raven process it finds, and the server could be writing the local database.

Downloads wait in `%LOCALAPPDATA%\raven-updater` on Windows (`~/Library/Caches/raven-updater` on macOS, `~/.cache/raven-updater` on Linux).

**v0.10.0 is the first release with update files.** Builds from before the updater (v0.9.0 and earlier) don't check for updates at all. Their users need to install one new build by hand.

**Unsigned Windows builds** don't check who signed an update (there's no signature to check). They trust GitHub's HTTPS and the sha512 in `latest.yml`, both from the same release. Signed builds also check the publisher name (see below).

## Signing

`scripts/build.ts` picks how to sign from the environment, and logs only the mode (`signing: ...`), never a value. With no keys, builds are exactly what they were before: an ad-hoc signature on macOS (Apple Silicon won't run an unsigned app) and nothing on Windows. Linux packages aren't signed.

On CI, keys reach the build step only on tags and manual runs, never on pull requests, and each OS gets only its own. Add them in the repo's **Settings → Secrets and variables → Actions** as repository secrets with exactly these names. A secret you don't set is empty, and that part stays unsigned.

### macOS: Developer ID and notarization

You need a paid Apple Developer Program membership.

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | Your **Developer ID Application** certificate and its private key, exported as a `.p12` file, then base64-encoded. |
| `CSC_KEY_PASSWORD` | The password you gave the `.p12` when you exported it. |
| `APPLE_API_KEY` | The whole text of the App Store Connect API key file (`AuthKey_XXXXXXXXXX.p8`). |
| `APPLE_API_KEY_ID` | That key's ID (the `XXXXXXXXXX` part). |
| `APPLE_API_ISSUER` | Your Issuer ID, shown above the keys list in App Store Connect. |

Getting them:

1. In Keychain Access on a Mac, make a certificate signing request (Certificate Assistant → Request a Certificate From a Certificate Authority, saved to disk).
2. In the Apple Developer site, go to Certificates, add a **Developer ID Application** certificate, upload the request and download the certificate. Open it so it lands in Keychain Access.
3. In Keychain Access, select the certificate together with its private key, export both as a `.p12` and set a password. Then `base64 -i Certificates.p12 | pbcopy` copies the value for `CSC_LINK`.
4. In App Store Connect, go to Users and Access → Integrations → App Store Connect API → Team Keys, and make a key with the **Developer** role. Download the `.p8` (Apple lets you download it only once) and copy its whole text into `APPLE_API_KEY`.

With `CSC_LINK` set, the build signs with the hardened runtime and `build/entitlements.hardened.plist` (JIT, which V8 needs). With all three `APPLE_API_*` secrets too, it notarizes, and the build checks the app with `codesign --verify` and `spctl`. The build also checks that the app is signed with a Developer ID Application certificate, and stops if it isn't. A partial set stops the build and names what's missing. On CI the key file is written to the runner's temp folder and deleted at the end of the job.

If a signed app won't start, look at library validation first: the entitlements keep it on, because Raven loads no native code from anyone else.

**On a Mac with certificates.** With no keys, the build asks for an ad-hoc signature with the identity `-`. But electron-builder first looks through the Mac's keychains, and it matches `-` anywhere in a name. So if a signing certificate there has a hyphen in its name, the build signs with that certificate instead, with no hardened runtime and no notarizing. GitHub's macOS runners have no certificates, so a CI build with no keys is always a real ad-hoc build. This only matters on a self-hosted runner or your own Mac. The build checks for it: with no keys, it runs `codesign -dvv` on the app and stops unless it prints `Signature=adhoc`. If that happens, set `CSC_LINK` to sign properly, or build on a Mac with no such certificate.

### Windows: Azure Trusted Signing, or a certificate

Use one of the two. Setting both stops the build.

**Azure Trusted Signing** (electron-builder's `azureSignOptions`):

| Secret | What it is |
| --- | --- |
| `AZURE_TENANT_ID` | Your Microsoft Entra tenant (directory) ID. |
| `AZURE_CLIENT_ID` | The app registration's application (client) ID. |
| `AZURE_CLIENT_SECRET` | A client secret of that app registration. |
| `RAVEN_AZURE_ENDPOINT` | The signing account's endpoint for its region, like `https://eus.codesigning.azure.net`. |
| `RAVEN_AZURE_ACCOUNT` | The signing account's name. |
| `RAVEN_AZURE_CERT_PROFILE` | The certificate profile's name. |
| `RAVEN_AZURE_PUBLISHER_NAME` | The name on the certificate (its CN), exactly. The updater checks it. |

Getting them:

1. In the Azure portal, create a Trusted Signing account, and pass identity validation for the name you sign as. Check first that Microsoft accepts your country and type (person or company).
2. Create a **Public Trust** certificate profile in that account.
3. In Microsoft Entra ID, register an app and give it a client secret.
4. On the signing account, give that app the **Trusted Signing Certificate Profile Signer** role.

**A certificate**: if you have a code-signing certificate as a `.pfx` file, set `WIN_CSC_LINK` (the `.pfx`, base64-encoded) and `WIN_CSC_KEY_PASSWORD`. electron-builder signs with signtool and reads the publisher name from the certificate.

Signed builds write the publisher name into `resources/app-update.yml`, and from then on the updater installs only updates signed with that name. If the name ever changes, those users have to install the next version by hand. The first signed version still installs over an unsigned one without a check, since the unsigned app has no name to compare. The build checks that the app and the installer have a valid Authenticode signature.

## Before the first real release

Signing and updating were built without accounts, so these paths haven't run yet:

- **Signed builds.** After adding the secrets, run the Desktop workflow by hand (Actions → Desktop → Run workflow). It signs but makes no release, since that needs a tag. Look for `signing: signed with ...` in the build log, then install and open the artifact.
- **An update from one release to the next.** It needs two published releases. Install vN from its release, publish vN+1, and watch the update arrive on Windows and in the AppImage.
