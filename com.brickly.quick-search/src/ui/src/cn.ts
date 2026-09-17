type ClassValue = string | false | null | undefined

/** 迷你 cn：页面只用字符串拼接与条件项，不引 clsx/tailwind-merge。 */
export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ')
}
