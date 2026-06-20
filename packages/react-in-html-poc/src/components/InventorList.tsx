export interface Inventor {
  name: string;
  invention: string;
  date: string;
}

interface InventorListProps {
  inventors: Inventor[];
}

function InventorListComponent({ inventors }: InventorListProps) {
  return (
    <div className="inventor-list">
      <h2 className="inventor-list-title">19th Century Inventors</h2>
      <div className="inventor-grid">
        {inventors.map((inventor) => (
          <div key={inventor.name} className="inventor-card">
            <div className="inventor-name">{inventor.name}</div>
            <div className="inventor-invention">{inventor.invention}</div>
            <div className="inventor-date">{inventor.date}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const css = `
  .inventor-list {
    font-family: system-ui, sans-serif;
    padding: 1.5rem;
    max-width: 720px;
  }
  .inventor-list-title {
    font-size: 1.2rem;
    font-weight: 700;
    margin-bottom: 1rem;
    color: #111;
  }
  .inventor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }
  .inventor-card {
    background: white;
    border-radius: 10px;
    padding: 1rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .inventor-name {
    font-weight: 700;
    font-size: 0.95rem;
    color: #111;
  }
  .inventor-invention {
    font-size: 0.875rem;
    color: #4f46e5;
  }
  .inventor-date {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: auto;
  }
`;

export const InventorList = Object.assign(InventorListComponent, { css });
