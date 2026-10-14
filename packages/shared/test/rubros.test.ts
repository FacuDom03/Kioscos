import { describe, expect, it } from 'vitest';
import {
  DATOS_RUBROS,
  MODULOS,
  RUBROS,
  esRubro,
  nombreModulo,
  tituloListo,
} from '../src/rubros.ts';

describe('rubros', () => {
  it('cada rubro activa solo funciones que ofrece', () => {
    for (const r of RUBROS) {
      const d = DATOS_RUBROS[r];
      expect(d.id).toBe(r);
      for (const m of d.modulos) expect(d.ofrecidos).toContain(m);
      for (const m of d.ofrecidos) expect(MODULOS).toContain(m);
    }
  });

  it('las categorías sugeridas no se repiten y entran en la base', () => {
    for (const r of RUBROS) {
      const nombres = DATOS_RUBROS[r].categorias.map((c) => c.nombre.toLowerCase());
      expect(new Set(nombres).size).toBe(nombres.length);
      for (const n of nombres) expect(n.length).toBeLessThanOrEqual(60);
    }
  });

  it('ferretería y perfumería usan el estilo sobrio; kiosco y almacén, el de kiosco', () => {
    expect(DATOS_RUBROS.ferreteria.estilo).toBe('sobrio');
    expect(DATOS_RUBROS.perfumeria.estilo).toBe('sobrio');
    expect(DATOS_RUBROS.kiosco.estilo).toBe('kiosco');
    expect(DATOS_RUBROS.almacen.estilo).toBe('kiosco');
  });

  it('arma los títulos y nombres en castellano', () => {
    expect(tituloListo('ferreteria')).toBe('Tu ferretería, lista para usar');
    expect(tituloListo('kiosco')).toBe('Tu kiosco, listo para usar');
    expect(tituloListo('otro')).toBe('Tu negocio, listo para usar');
    expect(nombreModulo('almacen', 'cuenta_corriente')).toBe('Fiado');
    expect(nombreModulo('ferreteria', 'cuenta_corriente')).toBe('Cuenta corriente');
  });

  it('reconoce los rubros válidos', () => {
    expect(esRubro('ferreteria')).toBe(true);
    expect(esRubro('agencia')).toBe(false);
    expect(esRubro(undefined)).toBe(false);
  });
});
