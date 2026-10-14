export function Proximamente({ titulo }: { titulo: string }) {
  return (
    <div className="pantalla">
      <h1 className="m-titulo">{titulo}</h1>
      <p className="texto-suave">Próximamente.</p>
    </div>
  );
}
