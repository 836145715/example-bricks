import { cn } from './cn'

/** 结果未提供图标时的积木占位。 */
export function BrickFallbackIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect x="5.2" y="2.1" width="5.2" height="4.4" rx="1.6" />
      <rect x="13.6" y="2.1" width="5.2" height="4.4" rx="1.6" />
      <rect x="3" y="5.8" width="18" height="14.4" rx="2.2" />
    </svg>
  )
}
