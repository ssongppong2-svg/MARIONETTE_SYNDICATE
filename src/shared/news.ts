/**
 * 궁정 신문. 처형은 "킬 로그"가 아니라 궁정의 공식 속보로 보도됩니다.
 * 공개: 누가 죽었는가 / 제한: 어디서(구역의 지명만) / 비공개: 누가 죽였는가
 */
import { FACTION_NAME, PIECES, ZONES, zoneOf } from './data';
import { josa } from './korean';
import type { DeathCause, Faction, NewsItem, PieceType } from './types';

export type Pick = <T>(items: readonly T[]) => T;

interface Subject { type: PieceType; owner: Faction; r: number; militia: boolean }

function label(s: Subject): string {
  const name = s.militia ? '민병' : PIECES[s.type].name;
  return `${FACTION_NAME[s.owner]}의 ${name}`;
}

type Draft = Omit<NewsItem, 'id' | 'turn'>;

export function deathNews(s: Subject, cause: DeathCause, opts: { vip: boolean; censored: boolean }, pick: Pick): Draft {
  const zone = zoneOf(s.r);
  if (opts.censored) {
    return {
      tag: '검열', title: '지면 삭제', zone: null, censored: true, tone: 'shadow',
      body: pick([
        '이 지면은 검은 잉크로 덮여 있다. 궁정은 이 사건에 대해 말하지 않기로 했다.',
        '인쇄공은 이 단락을 찍지 못했다. 활자는 새벽에 녹여졌다.',
        '삭제됨. 궁정 서기관의 인장만 남아 있다.',
      ]),
    };
  }
  const place = pick(ZONES[zone].places);
  const who = label(s);
  const name = s.militia ? '민병' : PIECES[s.type].name;

  if (opts.vip) {
    return {
      tag: '긴급 보도', title: '암살 확인', zone, censored: false, tone: 'blood',
      body: pick([
        `${place}에서 궁정의 핵심 인물인 ${josa(who, '이/가')} 쓰러졌다. 명백한 암살이며, 궁정은 깊은 충격에 휩싸였다.`,
        `${place}의 돌바닥에 ${who}의 인장 반지가 굴러다녔다. 그가 지키던 비밀도 함께 끝났다.`,
      ]),
    };
  }
  if (cause === 'poison') {
    return {
      tag: '궁정 속보', title: '독살 의혹', zone, censored: false, tone: 'shadow',
      body: pick([
        `${place}에서 ${josa(who, '이/가')} 연회 뒤 갑자기 숨을 거두었다. 술잔에는 쓴 냄새가 남아 있었다.`,
        `${josa(who, '이/가')} ${place}에서 피를 토하며 쓰러졌다. 의원은 고개를 저었다.`,
      ]),
    };
  }
  if (s.type === 'serf') {
    return {
      tag: '궁정 속보', title: s.militia ? '징집병 전사' : '실종 처리', zone, censored: false, tone: 'earth',
      body: s.militia
        ? `${place}에서 창을 든 ${josa(who, '이/가')} 쓰러졌다. 쟁기를 놓은 지 며칠 되지 않았다.`
        : pick([
            `${place}의 농노 하나가 자취를 감추었다. 누구도 그 행방을 묻지 않았다.`,
            `${place}에서 이름 없는 일꾼이 사라졌다. 장부에서 한 줄이 지워졌을 뿐이다.`,
            `${place}의 들녘에 빈 쟁기만 남았다. ${FACTION_NAME[s.owner]}의 곳간이 조금 가벼워졌다.`,
          ]),
    };
  }
  if (s.type === 'lord') {
    return {
      tag: '긴급 보도', title: '군주 서거', zone, censored: false, tone: 'blood',
      body: `${place}에서 ${FACTION_NAME[s.owner]}의 군주가 쓰러졌다. 왕관은 바닥을 굴렀고, 누구도 줍지 않았다.`,
    };
  }
  return {
    tag: '긴급 보도', title: '전사 보도', zone, censored: false, tone: 'blood',
    body: pick([
      `${place}에서 ${josa(who, '이/가')} 갑작스러운 습격으로 생을 마감하였다. 현장에 흔적은 없었고, 범인은 확인되지 않았다.`,
      `${place}에서 한 ${josa(name, '이/가')} 차갑게 식은 채 발견되었다. ${FACTION_NAME[s.owner]}의 문장이 피에 젖어 있었다. 목격자는 없었다.`,
      `${place}, ${who}의 죽음이 보고되었다. 궁정은 침묵으로 답했다.`,
    ]),
  };
}

export function purgeNews(s: Subject): Draft {
  return {
    tag: '궁정 공고', title: '숙청', zone: null, censored: false, tone: 'gold',
    body: `${FACTION_NAME[s.owner]}의 궁정이 스스로 ${josa(PIECES[s.type].name, '을/를')} 처단하였다. 너무 많은 것이 알려졌기 때문이다. 새 후계는 밝혀지지 않았다.`,
  };
}

export function doubleNews(original: Subject, pick: Pick): Draft {
  const zone = zoneOf(original.r);
  const place = pick(ZONES[zone].places);
  return {
    tag: '궁정 속보', title: '대역 발각', zone, censored: false, tone: 'shadow',
    body: `${place}에서 쓰러진 것은 ${josa(label(original), '이/가')} 아니었다. 같은 옷을 입은 농노가 대신 피를 흘렸다.`,
  };
}

export function bribeNews(s: Subject, to: Faction, pick: Pick): Draft {
  const zone = zoneOf(s.r);
  const place = pick(ZONES[zone].places);
  const name = s.militia ? '민병' : PIECES[s.type].name;
  return {
    tag: '궁정 소문', title: '변절', zone, censored: false, tone: 'gold',
    body: pick([
      `${place}의 ${josa(name, '이/가')} ${josa(FACTION_NAME[s.owner], '을/를')} 등지고 ${FACTION_NAME[to]}의 실에 매달렸다. 금화 몇 닢이면 충분했다.`,
      `${place}에서 ${FACTION_NAME[s.owner]}의 ${josa(name, '이/가')} 주인을 바꾸었다. 충성은 저울에 올랐고, 기울었다.`,
    ]),
  };
}

export function blessNews(s: Subject, pick: Pick): Draft {
  const zone = zoneOf(s.r);
  const place = pick(ZONES[zone].places);
  return {
    tag: '궁정 속보', title: '빗나간 칼날', zone, censored: false, tone: 'gold',
    body: `${place}에서 ${josa(label(s), '을/를')} 노린 칼날이 빗나갔다. 사제들은 신의 가호라 말한다.`,
  };
}
