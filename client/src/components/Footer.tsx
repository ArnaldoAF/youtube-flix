/** A small line at the bottom of every page with the version of the running build. */
export function Footer() {
  return (
    <footer className="px-4 pb-4 pt-10 text-center text-[10px] tracking-wide text-white/30 select-text">
      youtube-flix {__APP_VERSION__}
    </footer>
  );
}
