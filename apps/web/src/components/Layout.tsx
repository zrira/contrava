import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return <div className="shell">
    <header><NavLink className="brand" to="/">Contrava</NavLink><span>API contracts that watch themselves.</span></header>
    <div className="body"><nav aria-label="Main navigation"><NavLink to="/">Dashboard</NavLink><NavLink to="/apis">Tracked APIs</NavLink><NavLink to="/apis/new">Add API</NavLink><NavLink to="/workers">Workers</NavLink></nav><main><Outlet /></main></div>
  </div>;
}
