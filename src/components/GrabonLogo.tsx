interface GrabonLogoProps {
  className?: string;
  alt?: string;
}

export function GrabonLogo({ className = "h-10 w-auto", alt = "GRABON" }: GrabonLogoProps) {
  return <img src="/branding/grabon-logo.png" alt={alt} className={className} draggable={false} />;
}

export function GrabonMark({ className = "h-10 w-10", alt = "GRABON" }: GrabonLogoProps) {
  return <img src="/branding/grabon-mark.png" alt={alt} className={className} draggable={false} />;
}
