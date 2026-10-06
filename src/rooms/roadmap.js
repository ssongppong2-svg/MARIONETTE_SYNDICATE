/*
 * Force Chamber — chapters and chambers still in preparation.
 * Planned chambers appear in the chamber list as locked "준비 중" cards.
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});

  Lab.ChapterInfo = [
    { no: 1, name: '보정 구역', code: 'CALIBRATION WING', blurb: '중력을 재고, 마찰을 재고, 힘의 평형으로 줄을 건다.' },
    { no: 2, name: '평형 구역', code: 'EQUILIBRIUM WING', blurb: '돌림힘, 무게중심, 도르래의 역학적 이득.' },
    { no: 3, name: '운동 구역', code: 'MOTION WING', blurb: '탄성 에너지, 투사체, 충돌과 반발.' },
    { no: 4, name: '심층 구역', code: 'DEEP WING', blurb: '회전 관성, 원운동, 부력, 중력의 방향, 그리고 마지막 문.' },
  ];

  Lab.Roadmap = [
    { no: 4, chapter: 2, code: 'LEVER', title: '지렛대', tags: ['돌림힘', '보의 무게', '미지 질량'] },
    { no: 5, chapter: 2, code: 'OVERHANG', title: '무게중심', tags: ['쌓기', '조화급수', '균형추'] },
    { no: 6, chapter: 2, code: 'PULLEY', title: '도르래', tags: ['움직도르래', '역학적 이득', '도착 속도'] },
    { no: 7, chapter: 3, code: 'SPRING', title: '용수철', tags: ['훅의 법칙', '탄성 에너지', '마찰 일'] },
    { no: 8, chapter: 3, code: 'PROJECTILE', title: '포물선', tags: ['투사체', '두 개의 해', '장애물'] },
    { no: 9, chapter: 3, code: 'AIR TABLE', title: '공기 테이블', tags: ['탄성 충돌', '반발계수', '반사각'] },
    { no: 10, chapter: 4, code: 'ROLLING', title: '구르는 원통', tags: ['관성 모멘트', '구름 운동'] },
    { no: 11, chapter: 4, code: 'PENDULUM', title: '진자', tags: ['주기', '접선 속도', '절단'] },
    { no: 12, chapter: 4, code: 'ARCHIMEDES', title: '부력', tags: ['밀도', '중성 부력'] },
    { no: 13, chapter: 4, code: 'GRAVITY DIAL', title: '중력 벡터', tags: ['마찰각', '분류'] },
    { no: 14, chapter: 4, code: 'SYNTHESIS', title: '마지막 문', tags: ['반사판', '조각 암호'] },
  ];

  Lab.totalChambers = function () {
    return (Lab.Chambers ? Lab.Chambers.length : 0) + Lab.Roadmap.length;
  };
})(typeof window !== 'undefined' ? window : globalThis);
