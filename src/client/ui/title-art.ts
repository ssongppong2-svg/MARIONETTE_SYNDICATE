/**
 * 타이틀 그림: 위에서 내려오는 꼭두각시 조종대와 실, 그 끝에 매달린 금이 간 왕관.
 * manifest.art.title 이 있으면 그 그림을 대신 씁니다.
 */
import { PIECE_ICONS, paintIcon } from '../icons';
import { manifest, loadImage } from '../assets';

export async function paintTitle(cv: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr;
  cv.height = H * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);

  if (manifest.art.title) {
    const img = await loadImage(manifest.art.title);
    if (img) {
      const s = Math.max(W / img.width, H / img.height);
      ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0.25)');
      v.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
      return;
    }
  }

  const M = Math.min(W, H);
  const cx = W / 2;
  // 위에서 떨어지는 빛
  const cone = ctx.createRadialGradient(cx, -H * 0.1, 10, cx, H * 0.35, H * 0.9);
  cone.addColorStop(0, 'rgba(234,210,140,0.20)');
  cone.addColorStop(0.5, 'rgba(194,161,74,0.05)');
  cone.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cone;
  ctx.fillRect(0, 0, W, H);

  // 조종대 (나무 십자)
  const barY = H * 0.07;
  const barW = Math.min(W * 0.46, M * 0.7);
  const wood = ctx.createLinearGradient(0, barY - 10, 0, barY + 10);
  wood.addColorStop(0, '#6b5238');
  wood.addColorStop(1, '#2c2015');
  ctx.save();
  ctx.translate(cx, barY);
  ctx.rotate(-0.035);
  ctx.fillStyle = wood;
  ctx.fillRect(-barW / 2, -7, barW, 14);
  ctx.fillRect(-7, -M * 0.06, 14, M * 0.12);
  ctx.fillStyle = '#c2a14a';
  for (const x of [-barW / 2, barW / 2 - 10]) ctx.fillRect(x, -9, 10, 18);
  ctx.fillRect(-9, M * 0.06 - 8, 18, 10);
  ctx.restore();

  // 왕관 (아래쪽, 글자와 겹치지 않게)
  const crownY = H * 0.86;
  const crownS = Math.min(M * 0.2, H * 0.17);
  const anchors = [[-0.33, -0.27], [-0.16, -0.04], [0, -0.4], [0.16, -0.04], [0.33, -0.27]].map(([kx, ky]) => ({ x: cx + kx * crownS, y: crownY + ky * crownS }));
  const tops = [-0.5, -0.25, 0, 0.25, 0.5].map((k) => ({ x: cx + k * barW * (k === 0 ? 0 : 1), y: barY + (k === 0 ? M * 0.06 : 0) }));
  // 실
  for (let i = 0; i < anchors.length; i++) {
    const a = tops[i], b = anchors[i];
    const g = ctx.createLinearGradient(0, a.y, 0, b.y);
    g.addColorStop(0, 'rgba(234,226,208,0.65)');
    g.addColorStop(1, 'rgba(194,161,74,0.35)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2 + (i - 2) * 6, (a.y + b.y) / 2, b.x, b.y);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(cx, crownY);
  ctx.rotate(-0.07);
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  const gold = ctx.createLinearGradient(0, -crownS / 2, 0, crownS / 2);
  gold.addColorStop(0, '#f1dc95');
  gold.addColorStop(0.45, '#b08f3e');
  gold.addColorStop(1, '#4a3814');
  ctx.fillStyle = gold;
  paintIcon(ctx, PIECE_ICONS.lord.d, 0, 0, crownS);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255,245,215,0.25)';
  paintIcon(ctx, PIECE_ICONS.lord.d, -1, -1.5, crownS);
  ctx.fillStyle = gold;
  paintIcon(ctx, PIECE_ICONS.lord.d, 0, 0, crownS * 0.985);
  // 금 간 자국
  ctx.strokeStyle = 'rgba(15,15,18,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-crownS * 0.05, -crownS * 0.32);
  ctx.lineTo(crownS * 0.02, -crownS * 0.12);
  ctx.lineTo(-crownS * 0.04, crownS * 0.02);
  ctx.lineTo(crownS * 0.03, crownS * 0.2);
  ctx.stroke();
  // 피 한 방울
  ctx.fillStyle = '#7a1212';
  ctx.beginPath();
  const dx = crownS * 0.31, dy = -crownS * 0.06;
  ctx.moveTo(dx, dy);
  ctx.quadraticCurveTo(dx + 6, dy + 16, dx, dy + 22);
  ctx.quadraticCurveTo(dx - 6, dy + 16, dx, dy);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(dx, dy + 38, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 글자 뒤의 어둠 — 실이 제목 뒤로 지나가도 글자가 또렷하게
  const plate = ctx.createRadialGradient(cx, H * 0.5, 10, cx, H * 0.5, Math.max(W * 0.42, 420));
  plate.addColorStop(0, 'rgba(10,10,12,0.82)');
  plate.addColorStop(0.55, 'rgba(10,10,12,0.55)');
  plate.addColorStop(1, 'rgba(10,10,12,0)');
  ctx.fillStyle = plate;
  ctx.fillRect(0, 0, W, H);

  // 먼지
  for (let i = 0; i < 140; i++) {
    const x = cx + (Math.random() - 0.5) * W * 0.6;
    const y = Math.random() * H * 0.9;
    ctx.fillStyle = `rgba(234,210,140,${Math.random() * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 비네트
  const v = ctx.createRadialGradient(cx, H * 0.45, M * 0.2, cx, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}
