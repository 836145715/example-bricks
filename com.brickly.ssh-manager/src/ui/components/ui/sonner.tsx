import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useAppTheme } from '@/lib/use-app-theme'

function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  const theme = useAppTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
