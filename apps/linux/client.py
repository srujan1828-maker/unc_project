"""OmniSync native Linux companion. GTK 4 UI, standard-library HTTPS transport."""
import hashlib
import json
import os
import pathlib
import subprocess
import threading
import urllib.request
import urllib.error
from urllib.parse import urlparse


class Client:
    def __init__(self, origin, token=None):
        parsed = urlparse(origin)
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
            raise ValueError('Use HTTPS outside localhost.')
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('Enter a server origin without a path or credentials.')
        self.origin = origin.rstrip('/')
        self.token = token

    def request(self, path, method='GET', body=None, headers=None):
        request_headers = {'X-Omni-Client': '1', 'X-Omni-Cli': '1'}
        if self.token:
            request_headers['Authorization'] = 'Bearer ' + self.token
        if body is not None:
            request_headers['Content-Type'] = 'application/octet-stream' if isinstance(body, bytes) else 'application/json'
            if not isinstance(body, bytes):
                body = json.dumps(body).encode()
        request_headers.update(headers or {})
        request = urllib.request.Request(self.origin + '/api' + path, data=body, headers=request_headers, method=method)
        # Never forward device tokens through redirects to another origin.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            return urllib.request.build_opener(NoRedirect).open(request, timeout=60)
        except urllib.error.HTTPError as error:
            try:
                detail = json.loads(error.read()).get('error', str(error))
            except (ValueError, AttributeError):
                detail = str(error)
            raise RuntimeError(detail) from error

    def json(self, path, method='GET', body=None, headers=None):
        with self.request(path, method, body, headers) as response:
            return json.load(response)

    def upload(self, path):
        path = pathlib.Path(path)
        digest = hashlib.sha256()
        with path.open('rb') as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b''):
                digest.update(chunk)
        transfer = self.json('/transfers', 'POST', {'name': path.name, 'size': path.stat().st_size, 'sha256': digest.hexdigest()})
        offset = transfer['offset']
        with path.open('rb') as file:
            file.seek(offset)
            for chunk in iter(lambda: file.read(1024 * 1024), b''):
                offset = self.json(f"/transfers/{transfer['id']}/chunk", 'PUT', chunk, {'X-Offset': str(offset), 'X-Chunk-SHA256': hashlib.sha256(chunk).hexdigest()})['offset']
        return self.json(f"/transfers/{transfer['id']}/complete", 'POST', {})

    def download(self, transfer, destination):
        destination = pathlib.Path(destination)
        partial = destination.with_name(destination.name + '.omni-part')
        if destination.exists():
            raise ValueError('Choose a new filename; existing files are never overwritten.')
        try:
            with self.request(f"/transfers/{transfer['id']}/download") as response, partial.open('xb') as file:
                digest = hashlib.sha256()
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    file.write(chunk)
                if digest.hexdigest() != transfer['sha256']:
                    raise ValueError('The download checksum did not match.')
            partial.rename(destination)
        except Exception:
            partial.unlink(missing_ok=True)
            raise


def main():
    import gi
    gi.require_version('Gtk', '4.0')
    from gi.repository import Gtk, GLib, Gdk

    class App(Gtk.Application):
        def __init__(self):
            super().__init__(application_id='dev.omnisync.Companion')
            self.client = None
            self.refreshing = False
            self.last_notification = None
            self.connect('activate', self.activate)

        def activate(self, *_):
            self.window = Gtk.ApplicationWindow(application=self, title='OmniSync')
            self.window.set_default_size(720, 650)
            self.root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14)
            for side in ('top', 'bottom', 'start', 'end'):
                getattr(self.root, 'set_margin_' + side)(24)
            self.window.set_child(self.root)
            heading = Gtk.Label(label='OmniSync · One workspace, every device', xalign=0)
            heading.add_css_class('title-2')
            self.root.append(heading)
            self.status = Gtk.Label(label='Pair with your local workspace service.', xalign=0, wrap=True)
            self.root.append(self.status)
            self.server_entry = Gtk.Entry(placeholder_text='https://desktop.example:47800')
            self.name_entry = Gtk.Entry(text='My Linux desktop')
            self.code_entry = Gtk.Entry(placeholder_text='Single-use pairing code')
            self.root.append(self.server_entry); self.root.append(self.name_entry); self.root.append(self.code_entry)
            pair_button = Gtk.Button(label='Pair device')
            pair_button.add_css_class('suggested-action')
            pair_button.connect('clicked', self.pair)
            self.root.append(pair_button)
            self.pair_button = pair_button
            self.content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
            self.root.append(self.content)
            self.config_path = pathlib.Path(os.environ.get('XDG_CONFIG_HOME', pathlib.Path.home() / '.config')) / 'omnisync' / 'linux.json'
            if self.config_path.exists():
                try:
                    origin = json.loads(self.config_path.read_text())['origin']
                    token = subprocess.run(['secret-tool', 'lookup', 'application', 'omnisync', 'server', origin], check=True, capture_output=True, text=True).stdout.strip()
                    if token:
                        self.client = Client(origin, token); self.workspace()
                except Exception:
                    self.status.set_text('Unlock your system keyring or pair this device again.')
            self.window.present()
            GLib.timeout_add_seconds(5, self.refresh)

        def background(self, work, done=lambda value: None):
            def run():
                try:
                    result = work(); GLib.idle_add(lambda: (done(result), False)[1])
                except Exception as error:
                    message = str(error); GLib.idle_add(lambda: (self.status.set_text(message), False)[1])
            threading.Thread(target=run, daemon=True).start()

        def pair(self, *_):
            origin, name, code = self.server_entry.get_text().strip(), self.name_entry.get_text().strip(), self.code_entry.get_text().strip()
            def work():
                client = Client(origin)
                data = client.json('/join', 'POST', {'name': name, 'code': code, 'platform': 'Linux'})
                client.token = data['token']
                # Store the credential in Secret Service, never in the config JSON.
                subprocess.run(['secret-tool', 'store', '--label=OmniSync device', 'application', 'omnisync', 'server', client.origin], input=client.token, text=True, check=True, capture_output=True)
                self.config_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                self.config_path.write_text(json.dumps({'origin': client.origin}))
                return client
            def done(client):
                self.client = client; self.workspace()
            self.background(work, done)

        def workspace(self):
            for widget in (self.server_entry, self.name_entry, self.code_entry, self.pair_button):
                widget.set_visible(False)
            if self.content.get_first_child():
                return
            row = Gtk.Box(spacing=8)
            for label, handler in [('Send clipboard', self.send_clipboard), ('Send a file', self.choose_upload), ('Open full workspace', lambda *_: Gtk.show_uri(self.window, self.client.origin, Gdk.CURRENT_TIME))]:
                button = Gtk.Button(label=label); button.connect('clicked', handler); row.append(button)
            self.content.append(row)
            self.message_entry = Gtk.Entry(placeholder_text='Share a note or link…')
            self.message_entry.connect('activate', self.share_note)
            self.content.append(self.message_entry)
            scroll = Gtk.ScrolledWindow(vexpand=True)
            self.list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
            scroll.set_child(self.list); self.content.append(scroll); self.content.set_vexpand(True)
            self.refresh()

        def share_note(self, entry):
            text = entry.get_text()
            if not text.strip():
                return
            def done(_):
                if entry.get_text() == text:
                    entry.set_text('')
                self.refresh()
            self.background(lambda: self.client.json('/clipboard', 'POST', {'text': text}), done)

        def refresh(self):
            if not self.client or self.refreshing:
                return True
            self.refreshing = True
            def work():
                try:
                    return self.client.json('/state')
                finally:
                    self.refreshing = False
            self.background(work, self.render)
            return True

        def render(self, state):
            self.status.set_text(f"{state['space']['name']} · {len(state['devices'])} paired devices · {state['me']['name']}")
            while child := self.list.get_first_child():
                self.list.remove(child)
            self.list.append(Gtk.Label(label='Shared clipboard', xalign=0))
            for clip in state['clips'][:30]:
                row = Gtk.Box(spacing=8)
                label = Gtk.Label(label=clip['text'][:200], xalign=0, wrap=True, hexpand=True)
                row.append(label)
                button = Gtk.Button(label='Copy'); button.connect('clicked', lambda _, text=clip['text']: self.window.get_clipboard().set(text))
                row.append(button); self.list.append(row)
            self.list.append(Gtk.Label(label='Available files', xalign=0))
            for transfer in state['transfers']:
                if transfer['status'] == 'ready':
                    button = Gtk.Button(label=f"Download {transfer['name']} ({transfer['size']} bytes)")
                    button.connect('clicked', lambda _, item=transfer: self.choose_download(item)); self.list.append(button)

        def send_clipboard(self, *_):
            def received(clipboard, result):
                try:
                    text = clipboard.read_text_finish(result)
                    if text:
                        self.background(lambda: self.client.json('/clipboard', 'POST', {'text': text}), lambda _: self.refresh())
                except Exception as error:
                    self.status.set_text(str(error))
            self.window.get_clipboard().read_text_async(None, received)

        def choose_upload(self, *_):
            chooser = Gtk.FileChooserNative(title='Send a file', transient_for=self.window, action=Gtk.FileChooserAction.OPEN, accept_label='Send', cancel_label='Cancel')
            def selected(dialog, response):
                if response == Gtk.ResponseType.ACCEPT:
                    path = dialog.get_file().get_path()
                    if path:
                        self.status.set_text('Uploading and verifying…'); self.background(lambda: self.client.upload(path), lambda _: self.refresh())
                dialog.destroy()
            chooser.connect('response', selected); chooser.show()

        def choose_download(self, transfer):
            chooser = Gtk.FileChooserNative(title='Save verified file', transient_for=self.window, action=Gtk.FileChooserAction.SAVE, accept_label='Save', cancel_label='Cancel')
            chooser.set_current_name(transfer['name'])
            def selected(dialog, response):
                if response == Gtk.ResponseType.ACCEPT:
                    path = dialog.get_file().get_path()
                    if path:
                        self.background(lambda: self.client.download(transfer, path), lambda _: self.status.set_text('Verified file saved.'))
                dialog.destroy()
            chooser.connect('response', selected); chooser.show()
    App().run(None)


if __name__ == '__main__':
    main()
