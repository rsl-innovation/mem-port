/**
 * The admin panel's visual system, aligned to mem-port's own.
 *
 * Tokens are lifted verbatim from the marketing site's committed design system
 * ("Lit From Within", /Users/riatomar/websites/mem-port-website/DESIGN.md) so
 * the portal reads as the same product rather than a bolted-on tool.
 *
 * What carries over is the *register*, not the marketing page's machinery: the
 * Void ground, the Ember signal accent, the type hierarchy, hairline rules and
 * the no-shadow rule. The photography and the scroll-driven motion do not —
 * this is dense operational UI, and pinned parallax would be actively hostile
 * to an admin trying to revoke a key.
 *
 * Three of that system's named rules apply directly and are worth stating
 * because they are easy to erode:
 *
 *   The Constellation Rule — glow is a field of points, never a fill. Ember
 *     lights up dots, borders and single elements; it is never a background
 *     wash behind a block of text.
 *   The One Serif Rule — the display serif appears only at headline scale.
 *     The moment it becomes UI chrome the editorial effect collapses.
 *   The No Card-Shadow Rule — panels separate by a 1px rule or a background
 *     step, never a diffuse shadow.
 *
 * Stardust Teal is quarantined to the constellation graph on the explore page,
 * which is exactly the node/edge system the source system reserves it for.
 *
 * Fonts are named first with the fallbacks the design system itself specifies
 * (Georgia for the serif, system sans, ui-monospace). They are deliberately not
 * fetched from a CDN: the panel is served by the daemon under a strict
 * Content-Security-Policy and may well run inside a locked-down network, and
 * an admin screen should not fail to render because a font host is unreachable.
 */
export const THEME_CSS = `
:root{
  --void:#07060a; --panel:#111014; --panel-raised:#19171c;
  --rule:rgba(245,241,233,.14); --rule-soft:rgba(245,241,233,.08);
  --ink:#f5f1e9; --ink-dim:#b7b2ac; --ink-faint:#8d8880;
  --ember:#f2a24c; --ember-bright:#f7b876; --ember-dim:#8a5a20;
  --teal:#6fe0c9; --teal-dim:#3f8577;
  --danger:#ff8b6b;
  --r:10px; --pill:999px;
  --display:"Fraunces",Georgia,serif;
  --body:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--void);color:var(--ink);font:1.0625rem/1.65 var(--body);-webkit-font-smoothing:antialiased}
::selection{background:var(--ember);color:var(--void)}

a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--rule)}
a:hover{color:var(--ember);border-bottom-color:var(--ember)}
:focus-visible{outline:2px solid var(--ember);outline-offset:2px}

/* --- chrome ------------------------------------------------------------ */
header{border-bottom:1px solid var(--rule);background:var(--panel);position:sticky;top:0;z-index:10}
.wrap{max-width:1180px;margin:0 auto;padding:0 clamp(1.25rem,5vw,3rem)}
header .wrap{display:flex;align-items:center;gap:1.75rem;flex-wrap:wrap;min-height:64px}
.brand{font:600 1.0625rem/1 var(--body);letter-spacing:-.01em;border:0}
.brand span{color:var(--ember)}
nav{display:flex;gap:1.5rem;margin-left:auto;align-items:center}
nav a,nav .who{font:500 .75rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;border:0}
nav .who{color:var(--ink-faint)}
main{max-width:1180px;margin:0 auto;padding:clamp(2rem,5vw,3.25rem) clamp(1.25rem,5vw,3rem) 5rem}

/* --- type -------------------------------------------------------------- */
h1{font:500 clamp(1.875rem,3.4vw,2.75rem)/1.08 var(--display);margin:0 0 .5rem;letter-spacing:-.015em}
h1 em{font-style:italic;color:var(--ember)}
h2{font:500 1.5rem/1.15 var(--display);margin:2.75rem 0 1rem;letter-spacing:-.01em}
h3{font:600 1.125rem/1.3 var(--body);margin:1.75rem 0 .5rem}
.eyebrow{font:500 .75rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 .75rem}
.sub{color:var(--ink-dim);margin:0 0 2rem;max-width:66ch}
p{max-width:66ch}
.muted{color:var(--ink-faint)}
/* nowrap: an inline token like library-id split across two lines reads as two
   different things, and the bordered background makes the break look deliberate. */
code,kbd{font:.875rem/1.5 var(--mono);background:var(--panel-raised);border:1px solid var(--rule-soft);padding:.1em .45em;border-radius:6px;color:var(--ink);white-space:nowrap}
pre code{white-space:pre}
pre{background:var(--panel);border:1px solid var(--rule);border-radius:var(--r);padding:1rem 1.1rem;overflow-x:auto;margin:1rem 0}
pre code{background:0;border:0;padding:0;font-size:.8125rem;line-height:1.7;white-space:pre}

/* --- panels ------------------------------------------------------------ */
/* No shadows anywhere: separation is a 1px rule or a background step. */
.panel{background:var(--panel);border:1px solid var(--rule);border-radius:var(--r);padding:1.35rem 1.5rem;margin-bottom:1.5rem}
.panel.tight{padding:0;overflow:hidden}

table{width:100%;border-collapse:collapse}
th{font:500 .75rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding:.85rem 1.1rem;background:var(--panel-raised);border-bottom:1px solid var(--rule)}
td{padding:.85rem 1.1rem;border-bottom:1px solid var(--rule-soft);vertical-align:middle}
tr:last-child td{border-bottom:0}

/* --- forms ------------------------------------------------------------- */
label{display:block;font:500 .75rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:.4rem}
input,select{font:1rem/1.4 var(--body);padding:.6rem .75rem;border:1px solid var(--rule);border-radius:var(--r);background:var(--void);color:var(--ink);min-width:210px}
input::placeholder{color:var(--ink-faint)}
input:focus,select:focus{border-color:var(--ember);outline:none}
button{font:500 .9375rem/1 var(--body);padding:.65rem 1.05rem;border:0;border-radius:var(--r);background:var(--ember);color:var(--void);cursor:pointer}
button:hover{background:var(--ember-bright)}
button.ghost{background:0;border:1px solid var(--rule);color:var(--ink)}
button.ghost:hover{background:0;border-color:var(--ember);color:var(--ember)}
button.link{background:0;padding:.2rem 0;color:var(--danger);border-bottom:1px solid transparent;border-radius:0}
button.link:hover{background:0;border-bottom-color:var(--danger)}
button.link.quiet{color:var(--ink-dim)}
button.link.quiet:hover{color:var(--ember);border-bottom-color:var(--ember)}
form.inline{display:inline}
form.row{display:flex;gap:.75rem;flex-wrap:wrap;align-items:flex-end}
form.row>div{display:flex;flex-direction:column}
/* Match the inputs' box height exactly so the button sits on their baseline
   rather than a few pixels below it. */
form.row button{height:41px;padding-top:0;padding-bottom:0}

/* --- bits -------------------------------------------------------------- */
.pill{display:inline-block;font:500 .6875rem/1.6 var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:.1rem .6rem;border:1px solid var(--rule);border-radius:var(--pill);color:var(--ink-faint)}
.pill.on{color:var(--ember);border-color:var(--ember-dim)}
/* The Constellation Rule: Ember as a point of light, not a fill. */
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ember);box-shadow:0 0 8px rgba(242,162,76,.7);margin-right:.55rem;vertical-align:middle}
.note{border:1px solid var(--rule);border-left:2px solid var(--ember);border-radius:var(--r);padding:.9rem 1.1rem;margin-bottom:1.5rem;color:var(--ink-dim)}
.note.bad{border-left-color:var(--danger)}
.note strong{color:var(--ink)}
.empty{color:var(--ink-faint);padding:.5rem 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--rule-soft);border:1px solid var(--rule);border-radius:var(--r);overflow:hidden;margin-bottom:1.75rem}
.stat{background:var(--panel);padding:1.05rem 1.2rem}
.stat b{display:block;font:500 1.75rem/1.1 var(--display);color:var(--ink)}
.stat span{font:500 .6875rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}
.reveal{border:1px solid var(--ember-dim);border-left:2px solid var(--ember);border-radius:var(--r);padding:1.1rem 1.2rem;margin-bottom:1.75rem}
.reveal code{display:block;padding:.8rem .9rem;margin-top:.7rem;word-break:break-all;font-size:.875rem;background:var(--void);border-color:var(--rule)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem}
.toc{display:flex;flex-wrap:wrap;gap:1.1rem;margin:0 0 2.25rem;padding:0;list-style:none}
.toc a{font:500 .75rem/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;border-bottom-color:var(--rule-soft)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
`;
