import { useCallback, useRef, useState } from 'react';

export type ScreenSession = {
  callId: string;
  peer: string;
  role: 'sender' | 'viewer';
  status: 'waiting' | 'connecting' | 'live';
};
export function useScreen(
  send: (message: object) => void,
  notify: (text: string, error?: boolean) => void,
) {
  const [session, setSession] = useState<ScreenSession | null>(null);
  const [incoming, setIncoming] = useState<{ callId: string; from: string } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const current = useRef<ScreenSession | null>(null);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (value: ScreenSession | null) => {
    current.current = value;
    setSession(value);
  };
  const stop = useCallback(
    (signal = true) => {
      if (signal && current.current) {
        try {
          send({ type: 'screen.stop', callId: current.current.callId });
        } catch {
          /* Local cleanup still runs offline. */
        }
      }
      clearTimeout(timeout.current);
      current.current = null;
      peer.current?.close();
      peer.current = null;
      localStream.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      localStream.current = null;
      candidates.current = [];
      setSession(null);
      setStream(null);
      setIncoming(null);
    },
    [send],
  );
  function makePeer(callId: string) {
    // LAN-first: no third-party STUN/TURN service receives connection metadata.
    const pc = new RTCPeerConnection({ iceServers: [] });
    peer.current = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate)
        send({ type: 'screen.signal', callId, signal: { candidate: event.candidate.toJSON() } });
    };
    pc.ontrack = (event) => {
      setStream(event.streams[0] || new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && current.current) {
        clearTimeout(timeout.current);
        update({ ...current.current, status: 'live' });
      }
      if (['failed', 'closed'].includes(pc.connectionState) && current.current) {
        notify('Screen connection ended. Check that both devices are on the same network.', true);
        stop();
      }
    };
    return pc;
  }
  async function start(to: string) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      notify('Screen capture needs a supported desktop browser and HTTPS (or localhost).', true);
      return;
    }
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 24, width: { ideal: 1920 } },
        audio: false,
      });
      localStream.current = media;
      setStream(media);
      media.getVideoTracks()[0].onended = () => stop();
      send({ type: 'screen.request', to });
      timeout.current = setTimeout(() => {
        notify('The screen invitation timed out.');
        stop();
      }, 60000);
    } catch (e) {
      notify(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Screen sharing was cancelled.'
          : 'Unable to start screen sharing.',
        true,
      );
      stop(false);
    }
  }
  function accept() {
    if (!incoming) return;
    update({ callId: incoming.callId, peer: incoming.from, role: 'viewer', status: 'connecting' });
    makePeer(incoming.callId);
    send({ type: 'screen.accept', callId: incoming.callId });
    setIncoming(null);
    timeout.current = setTimeout(() => {
      notify('Could not connect. Both devices need a direct network path.', true);
      stop();
    }, 30000);
  }
  function decline() {
    if (incoming) send({ type: 'screen.stop', callId: incoming.callId });
    setIncoming(null);
  }
  async function handle(message: any) {
    try {
      if (message.type === 'screen.request')
        setIncoming({ callId: message.callId, from: message.from });
      if (message.type === 'screen.pending')
        update({ callId: message.callId, peer: message.to, role: 'sender', status: 'waiting' });
      if (message.type === 'screen.stop') {
        stop(false);
        notify('Screen-sharing session ended.');
      }
      if (message.type === 'screen.accept' && current.current?.callId === message.callId) {
        clearTimeout(timeout.current);
        update({ ...current.current!, status: 'connecting' });
        const pc = makePeer(message.callId);
        localStream.current
          ?.getTracks()
          .forEach((track) => pc.addTrack(track, localStream.current!));
        await pc.setLocalDescription(await pc.createOffer());
        send({
          type: 'screen.signal',
          callId: message.callId,
          signal: { description: pc.localDescription },
        });
        timeout.current = setTimeout(() => {
          notify('Could not connect. Check the local network.', true);
          stop();
        }, 30000);
      }
      if (
        message.type === 'screen.signal' &&
        current.current?.callId === message.callId &&
        peer.current
      ) {
        const pc = peer.current;
        if (message.signal.description) {
          await pc.setRemoteDescription(message.signal.description);
          for (const candidate of candidates.current.splice(0)) await pc.addIceCandidate(candidate);
          if (message.signal.description.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            send({
              type: 'screen.signal',
              callId: message.callId,
              signal: { description: pc.localDescription },
            });
          }
        } else if (message.signal.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(message.signal.candidate);
          else candidates.current.push(message.signal.candidate);
        }
      }
    } catch {
      notify('The screen session could not connect.', true);
      stop();
    }
  }
  return { session, incoming, stream, start, stop, accept, decline, handle };
}
