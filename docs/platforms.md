# Desktop platform support

Haus ships native installers and keeps compositor effects opt-in when the
desktop environment can report that its blur is enabled.

## macOS

The Homebrew cask installs the unsigned `.pkg` from the Haus GitHub release:

```sh
brew tap resonaura/tap
brew install --cask haus
```

For a package downloaded directly from a release, remove its quarantine flag
once before opening Installer. In Finder, Control-click the downloaded package
and choose **Open**, or use Terminal with the actual downloaded filename:

```sh
xattr -cr ~/Downloads/Haus-0.1.5-mac-arm64.pkg
```

The package postinstall script removes quarantine from `/Applications/Haus.app`
after installation, following the same local-build flow as ResoStage. The app
uses Liquid Glass on supported macOS versions and vibrancy as its older macOS
fallback.

## Windows

Download and run `Haus-<version>-win-x64.exe` or `Haus-<version>-win-arm64.exe`. The NSIS installer offers a
normal install flow, Start menu entry, and optional desktop shortcut. Acrylic
uses Electron's native material on Windows 11 22H2 and later; older Windows
versions use `SetWindowCompositionAttribute` with a decoded HWND, then a legacy blur fallback if acrylic is rejected. The window uses a transparent background without layered-window mode. CI calls both paths on real x64/ARM64 Windows HWNDs; this does not replace visual testing on Windows 10.

## Linux desktops and distributions

Releases include AppImage, Debian `.deb`, RPM, Arch `.pacman`, and a portable
`.tar.gz` build. Use the native package on Ubuntu/Debian, Fedora/RHEL/openSUSE,
and Arch-based systems respectively; AppImage or the archive covers other
distributions.

NixOS can run the AppImage through NixOS's AppImage integration. Add this to
your system configuration and rebuild:

```nix
programs.appimage = {
  enable = true;
  binfmt = true;
};
```

Then make the downloaded AppImage executable and launch it. If you do not want
to enable binfmt globally, run it with `appimage-run` instead.

The Linux sidebar stays solid unless Haus can confirm that the active desktop
blur is enabled: GNOME's Blur my Shell extension, KDE Plasma's KWin Blur effect,
or Hyprland's `decoration:blur:enabled` option. The state updates while Haus is
open. Other desktop environments keep the solid surface, so transparency does
not expose an unintended dark or unreadable background.

On Plasma, enable the Blur effect in System Settings → Workspace Behavior →
Desktop Effects. On Hyprland, keep `decoration.blur.enabled = true` and ensure
Haus is not excluded by a window rule. Haus uses translucent sidebar pixels
only while the compositor reports blur as active.
