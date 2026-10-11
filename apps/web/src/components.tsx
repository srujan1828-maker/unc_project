import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  File,
  FileText,
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Device } from './types';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <img src="/icon.svg" alt="" />
      <span>
        omni<span className="brand-light">sync</span>
        <span className="brand-period">.</span>
      </span>
    </div>
  );
}
export function DeviceIcon({ platform, size = 24 }: { platform: string; size?: number }) {
  const Icon =
    platform === 'Android' || platform === 'iOS'
      ? Smartphone
      : platform === 'Windows'
        ? Monitor
        : platform === 'Browser'
          ? Tablet
          : Laptop;
  return <Icon size={size} strokeWidth={1.65} />;
}
export function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase();
  return (
    <span
      className={`file-icon ${['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext || '') ? 'purple' : ext === 'pdf' ? 'peach' : ''}`}
    >
      {['md', 'txt', 'pdf', 'docx'].includes(ext || '') ? (
        <FileText size={21} />
      ) : (
        <File size={21} />
      )}
    </span>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function DeviceCard({
  device,
  me,
  onClick,
}: {
  device: Device;
  me: string;
  onClick: () => void;
}) {
  return (
    <button className={`device-card ${device.id === me ? 'current' : ''}`} onClick={onClick}>
      <div className="device-card-top">
        <span
          className={`device-symbol ${device.platform === 'Android' || device.platform === 'iOS' ? 'lavender' : ''}`}
        >
          <DeviceIcon platform={device.platform} size={30} />
        </span>
        <span className={`presence ${device.online ? 'online' : ''}`}>
          {device.online ? 'Connected' : 'Offline'}
        </span>
      </div>
      <h3>{device.name}</h3>
      <p>
        {device.platform} · {device.id === me ? 'This device' : device.role}
      </p>
      <div className="device-card-bottom">
        <span>
          {device.permissions.files && device.permissions.clipboard
            ? 'Files & clipboard'
            : 'Custom permissions'}
        </span>
        <ChevronRight size={16} />
      </div>
    </button>
  );
}
export async function copyText(value: string) {
  if (!navigator.clipboard) throw new Error('Clipboard access requires HTTPS or localhost.');
  await navigator.clipboard.writeText(value);
}
export function CopyButton({
  text,
  onResult,
  label = 'Copy',
}: {
  text: string;
  onResult: (text: string, error?: boolean) => void;
  label?: string;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await copyText(text);
          onResult('Copied to your clipboard.');
        } catch (e) {
          onResult((e as Error).message, true);
        }
      }}
    >
      <Copy size={16} />
    </button>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span>{checked && <Check size={10} />}</span>
    </button>
  );
}
