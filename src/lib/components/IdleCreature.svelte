<script lang="ts">
	// Idle-state critters for empty queues — calm, looping, pure SVG + CSS (no
	// libs, works offline), and they freeze politely under prefers-reduced-motion.
	//   turtle   — plods across the box, facing its direction of travel
	//   elephant — stands and sways its trunk
	//   monkey   — hangs from a branch and swings like a pendulum
	//   random   — picks turtle or elephant (chosen once, per mount)
	type Creature = 'turtle' | 'elephant' | 'monkey' | 'random';
	let { creature = 'random' as Creature }: { creature?: Creature } = $props();

	const reduce =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

	// Fixed once so a 'random' choice stays stable for this mount (a $derived keeps
	// the prop read reactive without re-rolling the coin).
	const seed = Math.random();
	const pick = $derived<Exclude<Creature, 'random'>>(
		creature === 'random' ? (seed < 0.5 ? 'turtle' : 'elephant') : creature
	);
</script>

<div class="track" class:still={reduce} aria-hidden="true">
	{#if pick === 'turtle'}
		<!-- Turtle: flipped so it FACES left, the way it travels (RTL-forward). -->
		<div class="walker">
			<svg viewBox="0 0 140 90" width="150" height="96" class="turtle">
				<ellipse class="shadow" cx="70" cy="80" rx="42" ry="6" />
				<g class="leg leg-a"><rect x="34" y="54" width="14" height="20" rx="6" /></g>
				<g class="leg leg-a"><rect x="88" y="54" width="14" height="20" rx="6" /></g>
				<path class="tskin tail" d="M28 52 q-12 2 -16 8 q10 0 18 -2 z" />
				<g class="body-bob">
					<path class="shell" d="M30 54 q10 -34 40 -34 q30 0 40 34 z" />
					<path class="shell-rim" d="M28 54 q42 10 84 0" />
					<path class="scute" d="M70 22 q-14 6 -18 30 q18 5 36 0 q-4 -24 -18 -30 z" />
					<path class="scute-line" d="M70 22 v32 M52 52 q18 5 36 0 M58 34 q12 4 24 0" />
				</g>
				<g class="leg leg-b"><rect x="40" y="56" width="16" height="22" rx="7" /></g>
				<g class="leg leg-b"><rect x="84" y="56" width="16" height="22" rx="7" /></g>
				<g class="head">
					<path class="tskin neck" d="M108 46 q16 -2 22 6 q-4 10 -20 8 z" />
					<circle class="tskin" cx="126" cy="46" r="12" />
					<circle class="eye" cx="130" cy="43" r="2.1" />
					<path class="smile" d="M124 52 q6 4 11 1" />
				</g>
			</svg>
		</div>
	{:else if pick === 'elephant'}
		<!-- Elephant: stands centred, ear flaps, trunk sways. -->
		<div class="center">
			<svg viewBox="0 0 170 130" width="170" height="130" class="elephant">
				<ellipse class="shadow" cx="88" cy="118" rx="58" ry="7" />
				<g class="ele-bob">
					<!-- legs -->
					<rect class="egrey" x="46" y="82" width="20" height="34" rx="8" />
					<rect class="egrey" x="72" y="84" width="20" height="32" rx="8" />
					<rect class="egrey" x="102" y="82" width="20" height="34" rx="8" />
					<!-- body -->
					<ellipse class="egrey" cx="86" cy="70" rx="52" ry="36" />
					<!-- head -->
					<circle class="egrey" cx="128" cy="60" r="30" />
					<!-- ear -->
					<ellipse class="ear egrey-d" cx="116" cy="58" rx="16" ry="22" />
					<!-- tusk -->
					<path class="tusk" d="M138 74 q4 12 -2 18" />
					<!-- eye -->
					<circle class="eye" cx="140" cy="52" r="2.6" />
					<!-- trunk (sways) -->
					<path class="trunk egrey" d="M150 66 q18 6 16 26 q-1 18 -14 24" />
				</g>
			</svg>
		</div>
	{:else}
		<!-- Monkey: hangs from a branch and swings. -->
		<div class="center">
			<svg viewBox="0 0 150 150" width="150" height="150" class="monkey">
				<!-- branch -->
				<rect class="branch" x="10" y="16" width="130" height="9" rx="4" />
				<circle class="shadow" cx="75" cy="146" r="26" />
				<g class="swing">
					<!-- gripping arm -->
					<path class="mfur" d="M70 22 q-6 14 4 24" stroke-width="9" fill="none" stroke-linecap="round" />
					<!-- body -->
					<ellipse class="mfur" cx="75" cy="78" rx="24" ry="28" />
					<ellipse class="mbelly" cx="75" cy="84" rx="14" ry="18" />
					<!-- free arm -->
					<path class="mfur" d="M55 66 q-16 10 -10 28" stroke-width="9" fill="none" stroke-linecap="round" />
					<!-- legs -->
					<path class="mfur" d="M66 100 q-10 14 -4 26" stroke-width="10" fill="none" stroke-linecap="round" />
					<path class="mfur" d="M86 100 q10 14 4 26" stroke-width="10" fill="none" stroke-linecap="round" />
					<!-- tail curl -->
					<path class="mfur" d="M96 86 q26 6 20 -20 q-2 -12 -12 -8" stroke-width="7" fill="none" stroke-linecap="round" />
					<!-- head -->
					<circle class="mfur" cx="75" cy="44" r="20" />
					<circle class="mface" cx="75" cy="47" r="13" />
					<circle class="mear mfur" cx="57" cy="42" r="7" />
					<circle class="mear mfur" cx="93" cy="42" r="7" />
					<circle class="eye" cx="69" cy="45" r="2.3" />
					<circle class="eye" cx="81" cy="45" r="2.3" />
					<path class="msmile" d="M69 53 q6 5 12 0" />
				</g>
			</svg>
		</div>
	{/if}
</div>

<style>
	.track {
		position: relative;
		width: 100%;
		max-width: 320px;
		height: 150px;
		overflow: hidden;
		margin-inline: auto;
		display: grid;
		place-items: center;
	}
	.center {
		display: grid;
		place-items: center;
	}

	.shadow {
		fill: rgb(0 0 0 / 0.12);
	}
	:global(.dark) .shadow {
		fill: rgb(0 0 0 / 0.35);
	}
	.eye {
		fill: #0f172a;
	}

	/* ---------- Turtle ---------- */
	.walker {
		position: absolute;
		top: 12px;
		left: 0;
		transform: scaleX(-1); /* face left = direction of travel */
		animation:
			plod 11s linear infinite,
			bob 1.1s ease-in-out infinite;
	}
	.shell {
		fill: #059669;
	}
	.shell-rim {
		fill: none;
		stroke: #047857;
		stroke-width: 5;
		stroke-linecap: round;
	}
	.scute {
		fill: #10b981;
	}
	.scute-line {
		fill: none;
		stroke: #065f46;
		stroke-width: 2;
		stroke-linecap: round;
		opacity: 0.55;
	}
	.tskin,
	.leg rect {
		fill: #34d399;
	}
	.smile {
		fill: none;
		stroke: #065f46;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.leg {
		transform-origin: 50% 60%;
	}
	.leg-a {
		animation: step 1.1s ease-in-out infinite;
	}
	.leg-b {
		animation: step 1.1s ease-in-out infinite;
		animation-delay: 0.55s;
	}
	.head {
		transform-origin: 118px 48px;
		animation: peek 3.3s ease-in-out infinite;
	}
	@keyframes plod {
		0% {
			transform: scaleX(-1) translateX(-200px);
		}
		100% {
			transform: scaleX(-1) translateX(200px);
		}
	}
	@keyframes bob {
		0%,
		100% {
			margin-top: 0;
		}
		50% {
			margin-top: 3px;
		}
	}
	@keyframes step {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		50% {
			transform: translateY(-5px) rotate(-8deg);
		}
	}
	@keyframes peek {
		0%,
		100% {
			transform: translateY(0) rotate(0deg);
		}
		50% {
			transform: translateY(-2px) rotate(4deg);
		}
	}

	/* ---------- Elephant ---------- */
	.egrey {
		fill: #94a3b8;
	}
	.egrey-d {
		fill: #7c8aa0;
	}
	.tusk {
		fill: none;
		stroke: #f8fafc;
		stroke-width: 4;
		stroke-linecap: round;
	}
	.trunk {
		transform-origin: 150px 66px;
		animation: sway 2.6s ease-in-out infinite;
	}
	.ear {
		transform-origin: 122px 48px;
		animation: flap 3.4s ease-in-out infinite;
	}
	.ele-bob {
		transform-origin: 88px 118px;
		animation: elebob 3.4s ease-in-out infinite;
	}
	@keyframes sway {
		0%,
		100% {
			transform: rotate(-12deg);
		}
		50% {
			transform: rotate(14deg);
		}
	}
	@keyframes flap {
		0%,
		100% {
			transform: rotate(0deg);
		}
		50% {
			transform: rotate(-10deg);
		}
	}
	@keyframes elebob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3px);
		}
	}

	/* ---------- Monkey ---------- */
	.branch {
		fill: #7c5a3a;
	}
	.mfur {
		fill: #8b5e3c;
		stroke: #8b5e3c;
	}
	.mbelly {
		fill: #d6b892;
	}
	.mface {
		fill: #e8cfa8;
	}
	.mear {
		stroke: none;
	}
	.msmile {
		fill: none;
		stroke: #5b3a22;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.swing {
		transform-origin: 72px 24px; /* the gripping hand on the branch */
		animation: swing 2.4s ease-in-out infinite;
	}
	@keyframes swing {
		0%,
		100% {
			transform: rotate(11deg);
		}
		50% {
			transform: rotate(-11deg);
		}
	}

	/* Reduced motion: hold still, centred. */
	.track.still .walker {
		position: static;
		transform: scaleX(-1);
		animation: none;
	}
	.track.still :global(.trunk),
	.track.still :global(.ear),
	.track.still :global(.ele-bob),
	.track.still :global(.swing),
	.track.still :global(.leg),
	.track.still :global(.head) {
		animation: none;
	}
</style>
