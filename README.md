# 마리오네트 신디케이트 · MARIONETTE SYNDICATE

> 금빛 궁정 위에 피와 그림자가 얹힌 중세 정치 암살극.
> 사람을 자원으로 삼고, 정보를 숨기고, 단 한 번의 처형으로 권력이 뒤집힌다.

10 × 10 보드에서 두 사람이 겨루는 **1대1 심리전 보드게임**입니다. 온라인 대전과 AI 대전이 있고, 3판 2선승제이며, 스팀 출시를 목표로 합니다.
규칙과 아트 디렉션은 [`docs/DESIGN.md`](docs/DESIGN.md)에 있습니다.

## 실행

Node.js 20 이상이 필요합니다.

```sh
npm install
npm run dev      # 개발: 대전 서버(8787) + 화면(http://localhost:5173)
npm test         # 규칙 엔진 + 대전 서버 테스트
npm run build    # dist/ (화면) + dist-server/ (서버)
npm start        # 빌드한 것을 한 프로그램으로 실행: http://localhost:8787
npm run build:artifact   # 서버 없이 AI 대전만 하는 파일 하나짜리 페이지: dist-artifact/marionette-syndicate.html
```

**AI 대전**은 서버 없이 브라우저 안에서 돌아갑니다. 난이도는 쉬움, 보통, 어려움 세 단계이고, 차례 시간 제한이 없습니다.
AI도 사람과 똑같이 자기 화면에 보이는 정보만 씁니다. 상대의 VIP는 심문, 밀정의 보고, 공개된 사실로 추리합니다.

친구와 두려면 서버를 인터넷에 올려야 합니다. `npm start` 하나가 화면과 대전 서버를 함께 띄우므로,
Node를 돌릴 수 있는 곳(Render, Railway, Fly.io, 개인 서버 등)이면 됩니다.

- 빌드 명령: `npm ci && npm run build`
- 실행 명령: `npm start`
- 포트: `PORT` 환경 변수를 따릅니다.

Vercel처럼 실시간 연결(WebSocket)을 오래 유지하지 못하는 곳은 맞지 않습니다.
화면과 서버를 따로 올렸다면 주소 뒤에 `?server=wss://서버주소/ws`를 붙여 열면 됩니다.

## 어떻게 두나

| | |
|---|---|
| 기물 고르기 | 내 기물을 누르면 갈 수 있는 칸(◇)과 칠 수 있는 적(붉은 모서리)이 보입니다 |
| 이동 | ◇ 칸을 누릅니다 |
| 처형 · 매수 · 심문 | 적을 누르면 할 수 있는 행동과, 못 하는 이유가 함께 나옵니다 |
| 능력 | 아래 칸의 버튼: 왕가의 지휘(군주), 심문(첩자), 축복(사제), 매수 |
| 카드 | 손패를 누르면 설명과 사용 버튼이 나옵니다. 숫자 키 `1`–`5`로도 엽니다 |
| 취소 | 오른쪽 클릭 또는 `Esc` |
| 차례 종료 | `E` |
| 규칙 | 화면 위쪽 책 아이콘 — 궁정 법전 |

## 구조

```
src/shared   규칙 엔진 (서버와 화면이 함께 씀)
             data(수치·기물·카드) · engine(판 진행) · rules(할 수 있는 것) · view(보여 줄 정보만)
             match(3판 2선승·시간) · ai(컴퓨터 상대) · news(궁정 신문) · korean(조사) · protocol(메시지)
src/server   대전 서버: hub(접속·대기열·방 코드·재접속) · main(HTTP + WebSocket)
src/client   화면: board(PixiJS 보드·그림·연출) · game(대전 화면) · ui(타이틀·로비·법전·설정)
             local(브라우저 안의 AI 대전) · audio(Web Audio 합성 효과음·배경음) · net(재연결) · assets(교체용 그림·소리)
tests        engine.test.ts · server.test.ts (두 봇이 실제로 접속해 매치를 끝까지 둡니다) · ai.test.ts
docs         DESIGN.md (설계서) · prototype/ (6월 프로토타입, 참고용)
```

서버만 규칙과 비밀 정보(VIP, 타겟, 손패, 덱)를 압니다. 플레이어에게는 그 사람이 봐도 되는 정보만 보내므로,
화면 코드를 뜯어봐도 상대의 지령은 알 수 없습니다.

## 그림과 소리 바꾸기

지금 그림과 소리는 모두 코드로 만듭니다. 파일을 `public/assets/` 아래에 넣고 `public/assets/manifest.json`에 적으면 그 파일이 대신 쓰입니다.

```json
{
  "audio": { "music": "assets/audio/theme.ogg", "execute": "assets/audio/execute.ogg" },
  "art": {
    "title": "assets/art/title.webp",
    "pieces": { "lord": "assets/art/lord.png", "assassin": "assets/art/assassin.png" }
  }
}
```

- 효과음 이름: `click` `hover` `select` `move` `execute` `death` `bribe` `bribeFail` `card` `seal` `news` `turnMine` `turnTheirs` `royal` `bless` `poison` `tick` `exposed` `victory` `defeat` `roundStart` `blocked` `error` `match`
- 기물 그림은 둥근 메달리온 안에 들어갑니다. 정사각형 그림을 쓰는 것이 좋습니다.
