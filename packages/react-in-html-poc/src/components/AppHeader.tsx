interface AppHeaderProps {
  appName: string;
  username: string;
}

function AppHeaderComponent({ appName, username }: AppHeaderProps) {
  const initials = username
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="app-header">
      <span className="app-header-name">{appName}</span>
      <div className="app-header-user">
        <span className="app-header-username">{username}</span>
        <div className="app-header-avatar">{initials}</div>
      </div>
    </header>
  );
}

const css = `
  .app-header {
    font-family: system-ui, sans-serif;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 1.5rem;
    height: 56px;
    background: #18181b;
    color: white;
    width: 100%;
    box-sizing: border-box;
  }
  .app-header-name {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: white;
  }
  .app-header-user {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .app-header-username {
    font-size: 0.875rem;
    color: #a1a1aa;
  }
  .app-header-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #4f46e5;
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

export const AppHeader = Object.assign(AppHeaderComponent, { css });
