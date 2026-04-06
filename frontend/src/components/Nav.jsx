import BentSpoonIcon from './BentSpoonIcon'
import ApronIcon from './ApronIcon'

export default function Nav({ page, setPage, kitchenOpen, onToggleKitchen, prefsOpen, onTogglePrefs, isWide }) {
  const link = (name, label) => (
    <a
      href="#"
      className={page === name ? 'active' : ''}
      data-tour={name}
      onClick={(e) => { e.preventDefault(); setPage(name) }}
    >
      {label}
    </a>
  )

  return (
    <nav className="top-nav">
      <a href="#" className="logo" onClick={(e) => { e.preventDefault(); setPage('plan') }}>
        meal<em>runner</em>
      </a>
      <div className="nav-right">
        <div className="nav-links">
          {link('plan', 'Plan')}
          {!isWide && link('grocery', 'Grocery')}
          {link('order', 'Order')}
          {link('receipt', 'Receipt')}
        </div>
        <div className="nav-icons">
          <span data-tour="kitchen">
            <BentSpoonIcon
              size={22}
              active={kitchenOpen}
              onClick={onToggleKitchen}
            />
          </span>
          <span data-tour="account">
            <ApronIcon
              size={22}
              active={prefsOpen}
              onClick={onTogglePrefs}
            />
          </span>
        </div>
      </div>
    </nav>
  )
}
