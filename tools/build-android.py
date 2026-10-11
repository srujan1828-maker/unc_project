#!/usr/bin/env python3
"""Use the installed Android toolchain; honor the cloud HTTPS proxy without disabling TLS."""
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
from urllib.parse import urlparse

root = pathlib.Path(__file__).resolve().parent.parent
env = os.environ.copy()
cloud = pathlib.Path('/workspace/.tools')
jdk = cloud / 'native-root/usr/lib/jvm/java-21-openjdk-amd64'
if not env.get('JAVA_HOME') and (jdk / 'bin/javac').exists():
    env['JAVA_HOME'] = str(jdk)
if not env.get('ANDROID_HOME') and (cloud / 'android/platforms/android-35').exists():
    env['ANDROID_HOME'] = str(cloud / 'android')
options = shlex.split(env.get('GRADLE_OPTS', ''))
proxy = urlparse(env.get('HTTPS_PROXY', ''))
if proxy.hostname:
    options += [f'-Dhttps.proxyHost={proxy.hostname}', f'-Dhttps.proxyPort={proxy.port or 80}', f'-Dhttp.proxyHost={proxy.hostname}', f'-Dhttp.proxyPort={proxy.port or 80}']
    # Authentication, when present, stays in environment configuration, never source.
    if proxy.username or proxy.password:
        raise SystemExit('Configure authenticated Gradle proxy access in your private Gradle properties file.')
if cloud.exists():
    env.setdefault('ANDROID_USER_HOME', str(cloud / 'android-home'))
    options += [f'-Duser.home={cloud / "android-home"}']
    if pathlib.Path('/etc/ssl/certs/java/cacerts').exists():
        options += ['-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts']
env['GRADLE_OPTS'] = ' '.join(shlex.quote(option) for option in options)
gradle = shutil.which('gradle')
if not gradle and (cloud / 'gradle-8.11.1/bin/gradle').exists():
    gradle = str(cloud / 'gradle-8.11.1/bin/gradle')
if not gradle:
    wrapper = root / 'apps/android' / ('gradlew.bat' if os.name == 'nt' else 'gradlew')
    if wrapper.exists():
        gradle = str(wrapper)
    else:
        raise SystemExit('Install Gradle 8.11.1, a JDK 17+, and Android SDK 35. See docs/NATIVE_CLIENTS.md.')
args = [gradle, '--no-daemon', '--max-workers=2']
if cloud.exists():
    args += ['-g', str(cloud / 'gradle-cache')]
args += sys.argv[1:] or [':app:assembleDebug']
raise SystemExit(subprocess.call(args, cwd=root / 'apps/android', env=env))
