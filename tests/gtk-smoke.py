"""Run under Xvfb with an isolated service fixture. Exercises native GTK actions."""
import importlib.util
import json
import pathlib
import sys
import time
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk, GLib

spec = importlib.util.spec_from_file_location('omni', pathlib.Path(__file__).parent.parent / 'apps/linux/client.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
fixture = json.loads(pathlib.Path(sys.argv[1]).read_text())
deadline = time.monotonic() + 20
phase = 0
result = {'passed': False}


def check():
    global phase
    windows = Gtk.Window.get_toplevels()
    if not windows.get_n_items():
        return True
    window = windows.get_item(0)
    app = window.get_application()
    if time.monotonic() > deadline:
        print('GTK smoke test timed out:', app.status.get_text())
        app.quit()
        return False
    if phase == 0:
        app.client = module.Client(fixture['origin'], fixture['token'])
        app.workspace()
        phase = 1
    elif phase == 1 and 'paired devices' in app.status.get_text():
        assert window.get_visible()
        app.message_entry.set_text('Shared through the native GTK interface')
        app.message_entry.emit('activate')
        phase = 2
    elif phase == 2 and not app.message_entry.get_text():
        state = app.client.json('/state')
        if state['clips'] and state['clips'][0]['text'] == 'Shared through the native GTK interface':
            result['passed'] = True
            print('GTK window, service connection, and native share action passed')
            app.quit()
            return False
    return True


GLib.timeout_add(150, check)
module.main()
raise SystemExit(0 if result['passed'] else 1)
