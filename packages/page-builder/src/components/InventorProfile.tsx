import type { PropSchema } from './schema';

export interface InventorData {
  name: string;
  invention: string;
  date: string;
  country?: string;
  bio?: string;
  birthYear?: number;
  deathYear?: number;
}

interface InventorProfileProps {
  inventor: InventorData;
}

function InventorProfileComponent({ inventor }: InventorProfileProps) {
  const { name, invention, date, country, bio, birthYear, deathYear } = inventor ?? {};
  const safeName = name ?? '';
  const safeInvention = invention ?? '';
  const safeDate = date ?? '';
  const lifespan =
    birthYear && deathYear ? `${birthYear} – ${deathYear}` : birthYear ? `b. ${birthYear}` : null;

  return (
    <div className="inv-profile">
      <div className="inv-profile-header">
        <div className="inv-profile-avatar">
          {safeName.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?'}
        </div>
        <div className="inv-profile-headline">
          <h2 className="inv-profile-name">{safeName}</h2>
          {lifespan && <p className="inv-profile-lifespan">{lifespan}</p>}
          {country && <p className="inv-profile-country">{country}</p>}
        </div>
      </div>

      <div className="inv-profile-section">
        <p className="inv-profile-label">Notable Invention</p>
        <p className="inv-profile-invention">{safeInvention}</p>
        <p className="inv-profile-date">{safeDate}</p>
      </div>

      {bio && (
        <div className="inv-profile-section">
          <p className="inv-profile-label">Biography</p>
          <p className="inv-profile-bio">{bio}</p>
        </div>
      )}
    </div>
  );
}

const css = `
  .inv-profile {
    font-family: system-ui, sans-serif;
    padding: 1.5rem;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .inv-profile-header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .inv-profile-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #4f46e5;
    color: white;
    font-size: 1.1rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .inv-profile-headline {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .inv-profile-name {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 700;
    color: #111;
  }
  .inv-profile-lifespan,
  .inv-profile-country {
    margin: 0;
    font-size: 0.8rem;
    color: #9ca3af;
  }
  .inv-profile-section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid #f0f0f0;
  }
  .inv-profile-label {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
  }
  .inv-profile-invention {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #4f46e5;
  }
  .inv-profile-date {
    margin: 0;
    font-size: 0.8rem;
    color: #9ca3af;
  }
  .inv-profile-bio {
    margin: 0;
    font-size: 0.875rem;
    color: #374151;
    line-height: 1.6;
  }
`;

const schema: PropSchema[] = [
  { name: 'inventor', kind: 'dynamic-data', type: 'object', required: true, description: 'Inventor object returned by tRPC or from context' },
];

export const InventorProfile = Object.assign(InventorProfileComponent, { css, schema });
