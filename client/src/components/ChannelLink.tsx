import { Link } from 'react-router-dom';
import { channelPath } from '../browse';

/** A channel name that opens the channel's page. Stops the click from also opening the card it sits in. */
export function ChannelLink({ channel, className = '' }: { channel: string; className?: string }) {
  return (
    <Link
      to={channelPath(channel)}
      onClick={(e) => e.stopPropagation()}
      className={`underline-offset-2 hover:text-white hover:underline ${className}`}
    >
      {channel}
    </Link>
  );
}
