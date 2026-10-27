import React from 'react';
import Icon from './Icon.jsx';

// Section links and mobile controls share navigation state supplied by useNavigation.
export default function Sidebar({ sidebarHidden, activeSection, hideButton, showButton, toggleSidebar, navigate, metadata }) {
  const menuItems = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'factors', label: 'Contributing factors', icon: 'bars' },
    { id: 'severity', label: 'Crash severity', icon: 'severity' },
    { id: 'timeline', label: 'Crash timeline', icon: 'trend' },
    { id: 'top-counties', label: 'Top 5 counties', icon: 'pie' },
    { id: 'district-map', label: 'Crash map', icon: 'map' },
  ];

  return (
    <>
      {sidebarHidden && (
        <button
          ref={showButton}
          className="sidebar-toggle sidebar-reopen"
          onClick={() => toggleSidebar(false)}
          aria-label="Show sidebar"
          title="Show sidebar"
          aria-expanded={false}
          aria-controls="dashboard-sidebar"
          type="button"
        >
          <Icon name="sidebar" />
        </button>
      )}

      {!sidebarHidden && (
        <button
          className="sidebar-backdrop"
          onClick={() => toggleSidebar(true)}
          aria-label="Close sidebar"
          type="button"
        />
      )}

      <aside
        className="sidebar"
        id="dashboard-sidebar"
        aria-label="Dashboard navigation"
        aria-hidden={sidebarHidden}
      >
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="brand" />
            </span>
            <span>
              Crash<br />Analytics
            </span>
          </div>
          <button
            ref={hideButton}
            className="sidebar-toggle"
            onClick={() => toggleSidebar(true)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            aria-expanded={true}
            aria-controls="dashboard-sidebar"
            type="button"
          >
            <Icon name="sidebar" />
          </button>
        </div>

        <p className="nav-caption">DASHBOARD</p>
        <nav aria-label="Dashboard sections">
          {menuItems.map(item => (
            <button
              key={item.id}
              className={`nav-item${activeSection === item.id ? ' active' : ''}`}
              onClick={() => navigate(item.id)}
              aria-label={item.label}
              title={item.label}
              aria-current={activeSection === item.id ? 'location' : undefined}
              type="button"
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="district-tag">
          <span className="eyebrow">District focus</span>
          <b>Lubbock</b>
          <span>{metadata ? `${metadata.available_filters.counties.length} counties · West Texas` : 'Dataset information pending'}</span>
        </div>
      </aside>
    </>
  );
}
