import { useEffect, useRef, useState } from 'react'
import { Avatar } from './People'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'

/** The signed-in person's button: opens a small menu with the theme switch and log out. */
export function AccountMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="account" ref={root}>
    <button type="button" className="rail-account" aria-label={`Account: ${name}`} aria-expanded={open} title={name} onClick={() => setOpen(!open)}>
      <Avatar name={name} size="small" /><span className="rail-account-label">{name}</span>
    </button>
    {open && <section className="account-menu" aria-label="Account">
      <p className="account-name"><Avatar name={name} size="small" /><strong>{name}</strong></p>
      <ThemeToggle labelled className="account-item" />
      <button type="button" className="account-item" onClick={() => { setOpen(false); onLogout() }}><Icon name="logout" size={17} /><span>Log out</span></button>
    </section>}
  </div>
}
