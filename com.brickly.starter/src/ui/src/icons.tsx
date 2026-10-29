import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps): IconProps {
  return {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props
  }
}

/** 品牌标记：一片叶子 */
export function LeafMark(props: IconProps) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 8.6l3.2 3L13 4.4" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 4h11M6.5 4V2.9a.9.9 0 01.9-.9h1.2a.9.9 0 01.9.9V4M4.2 4l.5 8.3a1 1 0 001 .95h4.6a1 1 0 001-.95L11.8 4M6.7 6.8v4M9.3 6.8v4" />
    </svg>
  )
}

export function WarnIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2.4L14.4 13H1.6L8 2.4z" />
      <path d="M8 6.6v3M8 11.4v.2" />
    </svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  )
}

export function MinusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 8h9" />
    </svg>
  )
}

export function MaxIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" />
    </svg>
  )
}

export function RestoreIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" />
      <path d="M5.5 5.5V4a1.5 1.5 0 011.5-1.5h4A1.5 1.5 0 0112.5 4v4a1.5 1.5 0 01-1.5 1.5h-1.5" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  )
}
