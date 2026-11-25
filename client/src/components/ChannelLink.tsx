import { Link } from 'react-router-dom';
import { channelPath, genrePath } from '../browse';

/** A genre chip that opens the genre's page, without also opening the card it sits in. */
export function GenreLink({ genre }: { genre: string }) {
  return (
    <Link
      to={genrePath(genre)}
      onClick={(e) => e.stopPropagation()}
      className="inline-block rounded-full border border-white/25 px-2.5 py-0.5 text-xs text-white/80 hover:border-white hover:bg-white/10 hover:text-white"
    >
      {genre}
    </Link>
  );
}

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
