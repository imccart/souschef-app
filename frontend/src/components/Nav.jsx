import BentSpoonIcon from './BentSpoonIcon'
import ApronIcon from './ApronIcon'

export default function Nav({ page, setPage, kitchenOpen, onToggleKitchen, prefsOpen, onTogglePrefs, isWide }) {
  const link = (name, label) => (
    <a
      href="#"
      className={page === name ? 'active' : ''}
      onClick={(e) => { e.preventDefault(); setPage(name) }}
    >
      {label}
    </a>
  )

  return (
    <nav className="top-nav">
      <a href="#" className="logo" onClick={(e) => { e.preventDefault(); setPage('plan') }}>
        sous<em>chef</em>
      </a>
      <div className="nav-right">
        <div className="nav-links">
          {link('plan', 'Plan')}
          {!isWide && link('grocery', 'Grocery')}
          {link('order', 'Order')}
          {link('receipt', 'Receipt')}
        </div>
        <div className="nav-icons">
          <BentSpoonIcon
            size={22}
            active={kitchenOpen}
            onClick={onToggleKitchen}
          />
          <ApronIcon
            size={22}
            active={prefsOpen}
            onClick={onTogglePrefs}
          />
        </div>
      </div>
    </nav>
  )
}
