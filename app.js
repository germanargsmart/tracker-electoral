// Escrutinio en vivo: lee datos/{eleccion}/eleccion.json y, según el modo,
// reproduce reproduccion.json (simulación) o consulta actual.json cada 30 s.
// Todo lo que se muestra sale de la instantánea más los datos fijos
// (electores y mesas por departamento): nunca del resultado final.

const params = new URLSearchParams(location.search);
const ELECCION = params.get("eleccion") || "er-2023-gob";
const BASE = `datos/${ELECCION}/`;
// Intensidad por ventaja (< 5, 5–15, ≥ 15 puntos). En modo oscuro la mezcla va hacia un
// fondo casi negro, así que el escalón más bajo necesita más color para separarse de "sin mesas".
const RAMPA_CLARA = [35, 65, 100];
const RAMPA_OSCURA = [68, 84, 100];
const rampa = () => (oscuro.matches ? RAMPA_OSCURA : RAMPA_CLARA);
const UMBRALES = [5, 15];

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("es-AR");
const pts = (x) => `${(Number.isFinite(x) ? x : 0).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} puntos`;
const pct = (x, d = 1) => (Number.isFinite(x) ? x : 0).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
const oscuro = matchMedia("(prefers-color-scheme: dark)");

let E, GEO, SERIE = [], idx = 0, reproduciendo = false, timer = null, velocidad = 1, orden = { col: "electores", dir: -1 };
let actual = null;

const colorDe = (l) => (oscuro.matches ? l.color_oscuro || l.color : l.color);

async function json(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function iniciar() {
  E = await json(BASE + "eleccion.json");
  GEO = await json(E.geo);
  document.title = `${E.titulo} · Elecciones en vivo`;
  $("titulo").textContent = E.titulo;
  $("fecha").textContent = E.fecha;
  $("nota").textContent = E.nota || "";
  $("fuente").textContent = E.fuente ? `Fuente: ${E.fuente}.` : "";
  dibujarMapaBase();
  dibujarLeyenda();

  if (E.en_vivo) {
    $("modo").textContent = "En vivo";
    $("modo").classList.add("en-vivo");
    $("reproductor").hidden = true;
    document.body.style.paddingBottom = "24px";
    const tic = async () => {
      try { mostrar(await json(BASE + "actual.json")); } catch (e) { console.warn(e); }
    };
    await tic();
    setInterval(tic, 30_000);
  } else {
    SERIE = await json(BASE + "reproduccion.json");
    $("deslizador").max = SERIE.length - 1;
    // Arranca en un momento con datos, para que la página no se vea vacía.
    idx = Math.min(SERIE.length - 1, Math.round(SERIE.length * 0.35));
    $("deslizador").value = idx;
    mostrar(SERIE[idx]);
    $("play").addEventListener("click", alternar);
    $("deslizador").addEventListener("input", (e) => { pausar(); idx = +e.target.value; mostrar(SERIE[idx]); });
    $("velocidad").addEventListener("click", () => {
      velocidad = velocidad === 1 ? 2 : velocidad === 2 ? 4 : 1;
      $("velocidad").textContent = `${velocidad}×`;
      if (reproduciendo) { pausar(); reproducir(); }
    });
  }
  oscuro.addEventListener("change", () => { dibujarLeyenda(); if (actual) mostrar(actual); });
}

// ---------- Reproductor ----------
function reproducir() {
  if (idx >= SERIE.length - 1) idx = 0;
  reproduciendo = true;
  $("icono-play").setAttribute("d", "M7 5h4v14H7zM13 5h4v14h-4z");
  $("play").setAttribute("aria-label", "Pausar");
  timer = setInterval(() => {
    idx += 1;
    $("deslizador").value = idx;
    mostrar(SERIE[idx]);
    if (idx >= SERIE.length - 1) pausar();
  }, 900 / velocidad);
}
function pausar() {
  reproduciendo = false;
  clearInterval(timer);
  $("icono-play").setAttribute("d", "M8 5v14l11-7z");
  $("play").setAttribute("aria-label", "Reproducir");
}
const alternar = () => (reproduciendo ? pausar() : reproducir());

// ---------- Cálculos (solo con la instantánea y los datos fijos) ----------
function calcular(s) {
  const L = E.listas;
  const positivos = s.votos.reduce((a, b) => a + b, 0);
  const emitidos = positivos + s.blancos + s.nulos;
  const electoresContados = Object.entries(s.departamentos)
    .reduce((a, [c, d]) => a + (d.mesas[1] ? E.departamentos[c].electores * d.mesas[0] / d.mesas[1] : 0), 0);
  const participacion = electoresContados > 0 ? emitidos / electoresContados : null;

  const deptos = Object.entries(s.departamentos).map(([codigo, d]) => {
    const fijo = E.departamentos[codigo];
    const pos = d.votos.reduce((a, b) => a + b, 0);
    const emi = pos + d.blancos + d.nulos;
    const [esc, tot] = d.mesas;
    const fracFalta = tot ? (tot - esc) / tot : 0;
    const electoresFalta = fijo.electores * fracFalta;
    // Tope estricto para el aviso de ventaja irremontable: cada mesa que falta, llena.
    const maxFalta = Math.min(fijo.electores, (tot - esc) * (E.max_electores_mesa || Infinity));
    const contados = fijo.electores * (tot ? esc / tot : 0);
    const partLocal = contados > 0 ? emi / contados : participacion;
    const votosFalta = partLocal ? electoresFalta * Math.min(partLocal, 1) : null;
    const ranking = d.votos.map((v, i) => i).sort((a, b) => d.votos[b] - d.votos[a]);
    const lider = pos > 0 ? ranking[0] : null;
    const margen = pos > 0 ? (d.votos[ranking[0]] - d.votos[ranking[1]]) / pos * 100 : 0;
    return { codigo, nombre: fijo.nombre, electores: fijo.electores, votos: d.votos, pos, esc, tot, electoresFalta, maxFalta, votosFalta, lider, margen };
  });

  const ranking = s.votos.map((v, i) => i).sort((a, b) => s.votos[b] - s.votos[a]);
  const ventaja = positivos > 0 ? s.votos[ranking[0]] - s.votos[ranking[1]] : 0;
  const electoresFalta = deptos.reduce((a, d) => a + d.electoresFalta, 0);
  const maxFalta = deptos.reduce((a, d) => a + d.maxFalta, 0);
  const votosFalta = deptos.reduce((a, d) => a + (d.votosFalta || 0), 0);
  return { L, positivos, emitidos, participacion, deptos, ranking, ventaja, electoresFalta, maxFalta, votosFalta };
}

// ---------- Render ----------
function mostrar(s) {
  actual = s;
  const c = calcular(s);
  const [esc, tot] = s.mesas;
  const pm = tot ? (esc / tot) * 100 : 0;
  $("pct-mesas").textContent = pct(pm);
  $("hora").textContent = `${s.hora} h`;
  $("hora-repro").textContent = s.hora;
  $("barra-mesas-relleno").style.width = `${pm}%`;
  $("barra-mesas").setAttribute("aria-valuenow", pm.toFixed(1));

  mostrarEstado(s, c);
  mostrarListas(c);
  pintarMapa(c);
  mostrarFalta(c);
  mostrarTabla(c);
}

function mostrarEstado(s, c) {
  const el = $("estado");
  if (c.positivos === 0) {
    el.innerHTML = aviso(null, `Todavía no hay mesas cargadas. Las primeras suelen entrar después de las 21.`);
    return;
  }
  const lider = c.L[c.ranking[0]];
  if (c.ventaja > c.maxFalta) {
    el.innerHTML = aviso(lider,
      `<strong>${lider.nombre}</strong> tiene una ventaja irremontable: ${fmt.format(c.ventaja)} votos, más de lo que suman las ${fmt.format(s.mesas[1] - s.mesas[0])} mesas que faltan aunque estuvieran llenas (${fmt.format(Math.round(c.maxFalta))} electores como máximo).`,
      true);
  } else {
    el.innerHTML = "";
  }
}

function aviso(lista, html, check = false) {
  const icono = check
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${colorDe(lista)}"/><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const color = lista ? `style="--color:${colorDe(lista)}"` : "";
  return `<div class="aviso" ${color}>${icono}<span>${html}</span></div>`;
}

function mostrarListas(c) {
  const cont = $("listas");
  if (!cont.children.length) {
    cont.innerHTML = c.L.map((l, i) => `
      <div class="lista" data-i="${i}">
        <div class="lista__nombre"><i></i><span>${l.nombre}</span></div>
        <div class="lista__pct">0%</div>
        <div class="lista__votos"><div class="lista__barra"><span></span></div><div class="lista__n">0 votos</div></div>
      </div>`).join("");
  }
  // Orden por votos, con el color fijo de cada lista.
  c.ranking.forEach((i, pos) => {
    const el = cont.querySelector(`[data-i="${i}"]`);
    el.style.setProperty("--c", colorDe(c.L[i]));
    el.style.order = pos;
    el.classList.toggle("lista--lider", pos === 0 && c.positivos > 0);
    const p = c.positivos ? (actual.votos[i] / c.positivos) * 100 : 0;
    el.querySelector(".lista__pct").textContent = pct(p);
    el.querySelector(".lista__barra span").style.width = `${p}%`;
    el.querySelector(".lista__n").textContent = `${fmt.format(actual.votos[i])} votos`;
    const nombre = el.querySelector(".lista__nombre");
    let badge = nombre.querySelector("em");
    if (pos === 0 && c.positivos > 0) {
      if (!badge) { badge = document.createElement("em"); nombre.append(badge); }
      badge.textContent = "Primera";
    } else if (badge) badge.remove();
  });
}

function tonoMapa(d) {
  if (d.lider === null) return null;
  const nivel = d.margen < UMBRALES[0] ? 0 : d.margen < UMBRALES[1] ? 1 : 2;
  return `color-mix(in oklab, ${colorDe(E.listas[d.lider])} ${rampa()[nivel]}%, var(--sin-datos))`;
}

function dibujarMapaBase() {
  const svg = $("mapa");
  svg.setAttribute("viewBox", GEO.viewBox);
  svg.innerHTML = GEO.departamentos.map((d) => `<path data-c="${d.codigo}" d="${d.d}"><title>${d.nombre}</title></path>`).join("");
  svg.querySelectorAll("path").forEach((p) => {
    p.querySelector("title").remove(); // el tooltip propio reemplaza al nativo
    p.addEventListener("mousemove", (e) => mostrarTooltip(p.dataset.c, e));
    p.addEventListener("mouseleave", ocultarTooltip);
    p.addEventListener("focus", (e) => mostrarTooltip(p.dataset.c, e));
    p.setAttribute("tabindex", "0");
  });
}

function pintarMapa(c) {
  const porCodigo = Object.fromEntries(c.deptos.map((d) => [d.codigo, d]));
  $("mapa").querySelectorAll("path").forEach((p) => {
    const d = porCodigo[p.dataset.c];
    const tono = d ? tonoMapa(d) : null;
    p.classList.toggle("sin-datos", !tono);
    p.style.fill = tono || "";
    p.setAttribute("aria-label", d ? `${d.nombre}: ${d.lider === null ? "sin datos" : E.listas[d.lider].corto + " primera"}` : "");
  });
}

function mostrarTooltip(codigo, e) {
  const d = calcular(actual).deptos.find((x) => x.codigo === codigo);
  if (!d) return;
  const t = $("tooltip");
  const filas = d.votos.map((v, i) => i).sort((a, b) => d.votos[b] - d.votos[a]).map((i) => {
    const l = E.listas[i];
    return `<div class="fila" style="--c:${colorDe(l)}"><i></i><span>${l.corto}</span><span>${d.pos ? pct((d.votos[i] / d.pos) * 100) : "–"}</span></div>`;
  }).join("");
  t.innerHTML = `<h3>${d.nombre}</h3>${filas}<div class="meta">${pct(d.tot ? (d.esc / d.tot) * 100 : 0, 0)} de las mesas · ${fmt.format(d.pos)} votos</div>`;
  t.hidden = false;
  const caja = $("mapa").parentElement.getBoundingClientRect();
  const x = (e.clientX ?? caja.left + caja.width / 2) - caja.left;
  const y = (e.clientY ?? caja.top + caja.height / 2) - caja.top;
  const ancho = t.offsetWidth, alto = t.offsetHeight;
  t.style.left = `${Math.min(Math.max(0, x + 14), caja.width - ancho)}px`;
  t.style.top = `${Math.max(0, y - alto - 14 < 0 ? y + 18 : y - alto - 14)}px`;
}
const ocultarTooltip = () => ($("tooltip").hidden = true);

function dibujarLeyenda() {
  if (!E) return;
  const fondo = getComputedStyle(document.documentElement).getPropertyValue("--sin-datos");
  $("leyenda").innerHTML = E.listas.map((l) => `
    <span class="leyenda__item"><span class="leyenda__rampa">${rampa().map((r) => `<i style="background:color-mix(in oklab, ${colorDe(l)} ${r}%, ${fondo})"></i>`).join("")}</span>${l.corto}</span>`).join("")
    + `<span class="leyenda__item leyenda__sin"><i></i>Sin mesas</span>`
    + `<span class="leyenda__item">Ventaja: menos de 5, de 5 a 15, 15 o más puntos</span>`;
}

function mostrarFalta(c) {
  const lista = c.deptos.filter((d) => d.votosFalta && d.votosFalta >= 1).sort((a, b) => b.votosFalta - a.votosFalta).slice(0, 6);
  if (c.positivos === 0) {
    $("falta").innerHTML = `<li class="vacio">Cuando entren las primeras mesas, acá aparece dónde queda más voto por contar.</li>`;
    $("falta-total").textContent = "";
    return;
  }
  if (!lista.length) {
    $("falta").innerHTML = `<li class="vacio">Ya entraron todas las mesas con datos.</li>`;
    $("falta-total").textContent = "";
    return;
  }
  $("falta").innerHTML = lista.map((d) => {
    const lider = d.lider === null ? null : E.listas[d.lider];
    const det = lider
      ? `<i style="--c:${colorDe(lider)}"></i>${lider.corto} va primera por ${pts(d.margen)}`
      : `Todavía sin mesas`;
    return `<li data-c="${d.codigo}">
      <span class="falta__nombre">${d.nombre}</span>
      <span class="falta__votos">~${fmt.format(Math.round(d.votosFalta / 100) * 100)}</span>
      <span class="falta__det">${det}<span class="falta__mini" title="mesas escrutadas"><span style="width:${(d.esc / d.tot) * 100}%"></span></span></span>
    </li>`;
  }).join("");
  $("falta").querySelectorAll("li[data-c]").forEach((li) => {
    const p = $("mapa").querySelector(`path[data-c="${li.dataset.c}"]`);
    li.addEventListener("mouseenter", () => p.classList.add("activo"));
    li.addEventListener("mouseleave", () => p.classList.remove("activo"));
  });
  const segundo = c.L[c.ranking[1]];
  const necesita = c.votosFalta ? (c.ventaja / c.votosFalta) * 100 : Infinity;
  const total = c.votosFalta >= 1000 ? fmt.format(Math.round(c.votosFalta / 1000) * 1000) : fmt.format(Math.round(c.votosFalta));
  const remonte = necesita >= 100
    ? `${segundo.corto} no la alcanzaría ni con todos los votos que faltan`
    : necesita < 0.1
      ? `con tanto por contar, ${segundo.corto} puede pasar adelante con muy poco`
      : `para pasar adelante, ${segundo.corto} tendría que sacarle más de ${pts(necesita)} de diferencia en lo que falta contar`;
  $("falta-total").innerHTML = `Faltan unos <strong>${total}</strong> votos y la diferencia entre los dos primeros es de ${fmt.format(c.ventaja)}: ${remonte}.`;
}

function mostrarTabla(c) {
  const cols = [
    { id: "nombre", t: "Departamento" },
    ...c.L.map((l, i) => ({ id: `l${i}`, t: l.corto, color: colorDe(l) })),
    { id: "mesas", t: "Mesas" },
    { id: "electores", t: "Electores" },
  ];
  const thead = $("tabla").tHead;
  thead.innerHTML = `<tr>${cols.map((k) => `<th data-col="${k.id}" ${orden.col === k.id ? `aria-sort="${orden.dir > 0 ? "ascending" : "descending"}"` : ""}>${k.color ? `<span class="c" style="--c:${k.color}"></span>` : ""}${k.t}</th>`).join("")}</tr>`;
  thead.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    orden = { col: th.dataset.col, dir: orden.col === th.dataset.col ? -orden.dir : th.dataset.col === "nombre" ? 1 : -1 };
    mostrarTabla(calcular(actual));
  }));
  const valor = (d, col) => col === "nombre" ? d.nombre : col === "mesas" ? (d.tot ? d.esc / d.tot : 0) : col === "electores" ? d.electores : (d.pos ? d.votos[+col.slice(1)] / d.pos : -1);
  const filas = [...c.deptos].sort((a, b) => {
    const va = valor(a, orden.col), vb = valor(b, orden.col);
    return (typeof va === "string" ? va.localeCompare(vb, "es") : va - vb) * orden.dir;
  });
  $("tabla").tBodies[0].innerHTML = filas.map((d) => `<tr>
      <td>${d.lider !== null ? `<span class="marca" style="--c:${colorDe(E.listas[d.lider])}"></span>` : `<span class="marca" style="--c:transparent"></span>`}${d.nombre}</td>
      ${d.votos.map((v, i) => `<td class="${i === d.lider ? "lider" : ""}">${d.pos ? pct((v / d.pos) * 100) : "–"}</td>`).join("")}
      <td>${pct(d.tot ? (d.esc / d.tot) * 100 : 0, 0)}</td>
      <td>${fmt.format(d.electores)}</td>
    </tr>`).join("");
}

iniciar().catch((e) => {
  $("titulo").textContent = "No se pudieron cargar los datos";
  console.error(e);
});
