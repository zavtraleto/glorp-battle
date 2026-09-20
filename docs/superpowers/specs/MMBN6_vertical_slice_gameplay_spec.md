# Vertical Slice: Combat Gameplay Specification

**Статус:** implementation specification  
**Цель:** рабочий вертикальный срез для полировки real-time combat  
**Референс:** Mega Man Battle Network 6: Cybeast Gregar / Falzar  
**Важно:** существующий в игре набор врагов и Battle Chips **не добавляется параллельно**. Текущий набор необходимо заменить/перенастроить под этот документ. После имплементации вертикальный срез должен содержать только перечисленные ниже элементы, если отдельно не указано иное.

---

## 1. Цель вертикального среза

Вертикальный срез предназначен не для демонстрации количества контента, а для проверки и полировки базовой боевой системы.

Необходимо проверить:

- движение игрока;
- ускорение/торможение и управляемость;
- чтение вражеских telegraph;
- реакцию на projectile;
- позиционирование относительно врага;
- melee range;
- timing атак;
- timing использования чипов;
- hitbox/hurtbox;
- hitstop;
- knockback;
- recovery после атаки;
- defensive timing;
- изменение доступного пространства;
- forced movement;
- взаимодействие нескольких угроз;
- понятность причин получения урона;
- понятность результата попадания;
- возможность осознанного Counter.

Система Folder building, элементы чипов и сложная прогрессия **не входят в этот этап**.

---

# 2. Основной принцип combat

В качестве референса используется структура боевого взаимодействия MMBN6:

```text
IDLE
  ↓
TELEGRAPH
  ↓
COMMITMENT
  ↓
ATTACK / HIT
  ↓
RECOVERY
  ↓
IDLE
```

Для каждой атаки противника и каждого атакующего чипа необходимо явно определить эти состояния.

### Требование

Игрок должен получать визуальную информацию о намерении противника **до момента, когда атака становится неизбежной**.

Необходимо избегать ситуаций:

- атака появляется без telegraph;
- projectile появляется слишком близко для реакции;
- hitbox активируется до визуального начала атаки;
- враг меняет направление без читаемой причины;
- projectile меняет направление без читаемой причины;
- damage происходит после визуального окончания атаки;
- recovery выглядит как idle;
- игрок получает damage, не понимая, какая часть hitbox его задела.

MMBN6 использует Counter как отдельную проверку timing: атакующий Battle Chip, попавший непосредственно перед атакой противника, может вызвать Counter; успешный Counter парализует врага и переводит MegaMan в Full Synchro. Это используется здесь как **дизайнерский принцип timing**, а не как требование буквально воспроизвести Full Synchro.

Источник: Capcom, MMBN Legacy Collection manual:
https://game.capcom.com/manual/REXEAC/vol2/en/steam/page/3/2

---

# 3. Враги вертикального среза

Использовать ровно семь семейств:

1. Mettaur
2. Canodumb
3. Swordy
4. Piranha
5. Armadill
6. OldStov
7. WindBox

Внутри вертикального среза достаточно одной базовой версии каждого врага.

Не вводить V2/V3/SP до завершения полировки базовых паттернов.

---

## 3.1 Mettaur

### Функция

Базовый tutorial / timing enemy.

### Референс MMBN6

Mettaur перемещается в своей колонке и атакует shockwave. В MMBN6 более сильные варианты могут закрываться шлемом и становиться неуязвимыми вне момента атаки. Один Mettaur атакует постоянно; несколько Mettaur атакуют по очереди.

Источник:
https://www.mmhp.net/GameHints/MMBN6-Data.html

### Что должен тестировать в нашей игре

- базовое движение врага;
- alignment с игроком;
- telegraph;
- melee/chip timing;
- Counter window;
- базовое уклонение.

### Требуемый паттерн

```text
позиционирование
→ короткий telegraph
→ attack commitment
→ shockwave
→ recovery
→ повтор
```

### Важное правило

Mettaur должен быть первым врагом, на котором игрок может понять:

> «Я могу не просто убегать. Я могу ждать момент атаки врага и использовать свой чип в этот момент».

### Полировка

На Mettaur первыми настраиваются:

- скорость игрока;
- startup базового чипа;
- attack telegraph;
- hitstop;
- recovery;
- Counter window.

---

# 3.2 Canodumb

### Функция

Чистый projectile / reaction test.

### Референс

Canodumb является классическим стационарным cannon-type вирусом. Его базовая функция в серии заключается в прицеливании и выстреле после короткого предупреждения. Для MMBN6 в качестве ближайшего родственного поведения также используется Gunner, который выполняет аналогичную функцию stationary targeted projectile threat.

### Что должен тестировать

- реакцию игрока;
- скорость projectile;
- читаемость target indication;
- horizontal/vertical alignment;
- dodge timing.

### Требуемый паттерн

```text
игрок попадает в линию
→ target / warning
→ короткая задержка
→ projectile
→ recovery
```

### Дизайнерское правило

Canodumb не должен требовать сложной стратегии.

Если игрок получил damage от Canodumb, причина должна быть очевидной:

> «Я остался в линии атаки».

### Полировка

Настроить:

- warning duration;
- projectile speed;
- projectile size;
- hitbox;
- минимальное время между выстрелами;
- время восстановления.

Не делать projectile настолько быстрым, чтобы dodge превращался в угадайку.

---

# 3.3 Swordy

### Функция

Melee range / spatial reading.

### Референс MMBN6

Swordy приближается, пытается выровняться с игроком и использует LongSword или WideSword в зависимости от положения. В некоторых паттернах также используется AreaGrab, если игрок долго остаётся в безопасной дальней позиции.

Источник:
https://gamefaqs.gamespot.com/gba/929992-mega-man-battle-network-6-cybeast-falzar/faqs/47837

Дополнительное описание:
https://www.mmhp.net/GameHints/MMBN6-Data.html

### Что должен тестировать

- понимание дистанции;
- чтение melee range;
- боковое перемещение;
- positioning;
- решение «уйти или контратаковать».

### Требуемый паттерн

```text
приближение
→ alignment
→ sword telegraph
→ melee hitbox
→ recovery
```

### Требование

Hitbox Swordy должен быть визуально очевидным.

Не должно быть ситуации, когда визуальный меч уже исчез, а hitbox всё ещё активен.

### Полировка

Отдельно настроить:

- distance до атаки;
- approach speed;
- telegraph;
- sword active window;
- recovery;
- horizontal/vertical reach.

---

# 3.4 Piranha

### Функция

Target lock / delayed threat / prediction.

### Референс MMBN6

Piranha перемещается вверх-вниз в своей колонке и создаёт target cursor. Если один Piranha фиксирует цель, остальные Piranha также атакуют. После lock они выпускают стрелу по горизонтали.

Источник:
https://www.mmhp.net/GameHints/MMBN6-Data.html

### Что должен тестировать

- чтение намерения;
- удержание позиции;
- предсказание;
- реакцию на delayed attack;
- понимание связи между telegraph и projectile.

### Требуемый паттерн

```text
movement
→ target cursor
→ lock
→ короткая задержка
→ projectile
→ recovery
```

### Главное отличие от Canodumb

Canodumb:

> «Я вижу линию и должен уйти».

Piranha:

> «Я вижу, что меня сейчас выбрали целью, и должен изменить ситуацию до выстрела».

Это разные навыки. Оба должны присутствовать.

---

# 3.5 Armadill

### Функция

State change / invulnerability / timing.

### Референс MMBN6

Armadill следует за игроком по колонке. Когда оказывается на одной линии с MegaMan, сворачивается и атакует, двигаясь вперёд. Во время свернутого состояния панцирь защищает его от большинства атак.

Источник:
https://gamefaqs.gamespot.com/gba/929992-mega-man-battle-network-6-cybeast-falzar/faqs/47837

### Что должен тестировать

- чтение состояния врага;
- timing;
- знание момента уязвимости;
- наказание неправильного момента атаки;
- anticipation.

### Требуемые состояния

```text
FOLLOW
→ ALIGN
→ VULNERABLE / PRE-ATTACK
→ ARMORED ATTACK
→ RECOVERY
```

### Ключевое правило

Игрок должен понимать:

> «Сейчас его нельзя нормально ударить».

Это должен быть не невидимый флаг, а очевидное состояние модели/анимации.

### Полировка

Проверить:

- момент перехода в armored state;
- визуальный telegraph;
- точный момент включения armor;
- момент отключения armor;
- движение во время атаки;
- collision;
- damage timing.

Armadill нужен для проверки того, что timing работает не только у атак игрока, но и у **состояний врага**.

---

# 3.6 OldStov

### Функция

Spatial pressure / field interaction.

### Референс MMBN6

OldStov медленно перемещается по кругу и выпускает поток огня на три панели перед собой. Более сильные варианты дополнительно повреждают панели.

Источник:
https://www.mmhp.net/GameHints/MMBN6-Data.html

### Что должен тестировать

- чтение направления;
- выбор безопасного места;
- взаимодействие с полем;
- длительный active area;
- spatial pressure.

### Требуемый паттерн

```text
movement
→ rotation/alignment
→ fire telegraph
→ persistent attack zone
→ recovery
```

### В нашей версии

Элементная система пока отсутствует.

Поэтому:

- не использовать Fire/Aqua/Elec/Wood как gameplay mechanic;
- не вводить elemental weakness;
- цвет атаки использовать только визуально;
- основной gameplay effect: area denial / изменение пространства.

### Полировка

Особое внимание:

- ширине огненной зоны;
- длительности зоны;
- понятности безопасных клеток;
- времени на выход;
- взаимодействию с другими врагами.

---

# 3.7 WindBox

### Функция

Forced movement / control disruption.

### Референс MMBN6

WindBox создаёт постоянный поток воздуха, который толкает MegaMan независимо от позиции. Сам по себе WindBox мало опасен, но мешает против других врагов. Он также может снимать Barrier и Aura.

Источник:
https://www.mmhp.net/GameHints/MMBN6-Data.html

### Что должен тестировать

- forced movement;
- устойчивость управления;
- сохранение контроля;
- взаимодействие movement и attack timing;
- fairness при внешнем воздействии.

### Требуемый паттерн

WindBox не должен наносить основной damage.

Он создаёт:

```text
WIND ACTIVE
→ PLAYER DISPLACEMENT
→ WIND RECOVERY / INTERRUPTION
```

### Критическое требование

WindBox нельзя добавлять до того, как базовое движение игрока будет отполировано.

Если управление без WindBox ощущается нестабильно, WindBox только замаскирует проблему.

---

# 4. Рекомендуемая последовательность появления врагов

Не использовать всех семерых одновременно.

### Stage 1

**Mettaur**

Тест:

- movement;
- basic attack;
- basic chip;
- timing.

### Stage 2

**Mettaur + Canodumb**

Тест:

- melee/close threat;
- projectile threat;
- выбор направления движения.

### Stage 3

**+ Swordy**

Тест:

- spatial positioning;
- melee range;
- approach threat.

### Stage 4

**+ Piranha**

Тест:

- delayed threat;
- target lock;
- anticipation.

### Stage 5

**+ Armadill**

Тест:

- state changes;
- invulnerability;
- timing attack vs defense.

### Stage 6

**+ OldStov**

Тест:

- area denial;
- field pressure;
- multi-threat situations.

### Stage 7

**+ WindBox**

Финальный stress test:

- forced movement;
- movement stability;
- interaction between independent threats.

---

# 5. Battle Chip set

На этапе vertical slice использовать **10 чипов**.

Элементная система не используется.

## Attack

### Cannon

Роль:

- slow baseline projectile;
- single target;
- простой timing.

В MMBN6 Cannon является базовой одиночной пушкой; в серии это один из наиболее ранних и понятных projectile archetypes.

Источник:
https://megaman.fandom.com/wiki/Cannon_%28Battle_Chip%29

### Vulcan

Роль:

- fast multi-hit;
- проверка rapid timing;
- проверка sustained hitbox.

В MMBN6 Vulcan представляет собой серию быстрых выстрелов. Он полезен как противоположность Cannon: быстрый input → серия hits.

Источник:
https://battlenetwork.fandom.com/wiki/Vulcan

### WideShot

Роль:

- широкий projectile;
- проверка hitbox;
- атака по нескольким позициям.

Не использовать elemental variant.

---

## Melee

### Sword

Роль:

- базовая melee attack;
- короткий range;
- высокий timing requirement.

### WideSword

Роль:

- расширенный melee hitbox;
- проверка пространственного чтения;
- сравнение с Sword.

### MiniBomb

Роль:

- delayed projectile;
- позиционирование;
- атака с commitment.

В MMBN6/серии MiniBomb используется как простой бросаемый взрывной projectile.

Источник для чип-структуры:
https://megaman.fandom.com/wiki/Folder

---

## Field / Control

### AreaGrab

Роль:

- изменение доступного пространства;
- подготовка позиции;
- усиление пространственного давления.

В MMBN6 Swordy может использовать AreaGrab как часть своего давления на игрока.

Источник:
https://gamefaqs.gamespot.com/gba/929992-mega-man-battle-network-6-cybeast-falzar/faqs/47837

### PanelGrab

Роль:

- локальное изменение поля;
- проверка точечного field manipulation.

AreaGrab и PanelGrab должны ощущаться как два разных масштаба одной системы:

```text
PanelGrab = local
AreaGrab  = global / large
```

---

## Defense

### Barrier

Роль:

- defensive timing;
- принятие решения «атаковать или защищаться»;
- проверка взаимодействия с WindBox.

Barrier не должен превращать игрока в постоянно защищённого персонажа.

Его задача в vertical slice:

> дать игроку инструмент пережить одну конкретную угрозу.

---

## Recovery

### Recover

Роль:

- resource decision;
- проверка безопасного окна;
- проверка commitment при использовании recovery.

Recover должен требовать осознанного момента использования.

Не разрешать игроку лечиться без риска во время активной атаки врага.

---

# 6. Chip timing philosophy

**Не копировать frame data MMBN6.**

Сохранять относительную структуру.

## Timing classes

### FAST

Пример: Vulcan.

Характеристики:

- короткий startup;
- быстрое начало эффекта;
- несколько быстрых hits;
- маленькое окно для отмены/реакции.

Использование:

> punishment / reaction / Counter.

### MEDIUM

Пример: Sword / WideShot.

Характеристики:

- читаемый startup;
- понятный active window;
- умеренный commitment.

Использование:

> основной боевой инструмент.

### SLOW

Пример: Cannon / MiniBomb.

Характеристики:

- заметный startup;
- более высокий commitment;
- игрок должен заранее выбрать момент.

Использование:

> prediction / setup / punishment.

---

# 7. Отношение таймингов

Вместо копирования чисел MMBN6 использовать отношение:

```text
FAST
~ 1x

MEDIUM
~ 2–3x FAST

SLOW
~ 3–5x FAST
```

Это не математическая формула баланса. Это стартовая иерархия.

Главное:

```text
Vulcan < Sword/WideShot < Cannon/MiniBomb
```

по startup/commitment.

Не допускать ситуации:

```text
Cannon
= почти такой же быстрый, как Vulcan
```

иначе исчезает смысл разных attack archetypes.

---

# 8. Enemy timing philosophy

Не копировать абсолютные frame values MMBN6.

Сохранять относительные категории.

## Enemy A: immediate

Пример:

Mettaur.

```text
короткий telegraph
→ attack
→ короткий recovery
```

## Enemy B: projectile

Пример:

Canodumb.

```text
target
→ warning
→ projectile
→ recovery
```

## Enemy C: delayed

Пример:

Piranha.

```text
target lock
→ delay
→ projectile
```

## Enemy D: melee

Пример:

Swordy.

```text
approach
→ alignment
→ attack
```

## Enemy E: state-based

Пример:

Armadill.

```text
vulnerable
→ armor
→ attack
→ vulnerable
```

## Enemy F: area denial

Пример:

OldStov.

```text
telegraph
→ persistent zone
→ recovery
```

## Enemy G: forced movement

Пример:

WindBox.

```text
wind ON
→ displacement
→ wind OFF
```

---

# 9. Counter system

В оригинальном MMBN6 Counter выполняется атакующим чипом в момент непосредственно перед атакой противника. Успешный Counter парализует врага и активирует Full Synchro.

Источник:
https://game.capcom.com/manual/REXEAC/vol2/en/steam/page/3/2

Для нашей игры:

### Counter должен быть отдельным timing skill.

Не делать Counter случайным бонусом за обычное попадание.

Каждый из следующих врагов должен иметь определяемое Counter window:

- Mettaur: обязательно;
- Canodumb: желательно;
- Swordy: обязательно;
- Piranha: желательно;
- Armadill: обязательно;
- OldStov: после начала атаки;
- WindBox: не делать основным Counter enemy.

### Counter window

Для каждой атаки хранить отдельно:

```text
telegraphStart
attackCommit
counterStart
counterEnd
hitFrame
recoveryStart
recoveryEnd
```

Это должно быть частью enemy attack configuration.

---

# 10. Fairness requirements

## Damage должен иметь причину

При каждом получении damage debug overlay должен позволять увидеть:

```text
enemy
attack
hitbox
player hurtbox
attack state
frame/state
```

## Hitbox не должен опережать визуал

Если игрок визуально видит:

```text
меч ещё не касается игрока
```

он не должен получать damage.

## Projectile должен быть читаем

Минимальные требования:

- видимый spawn;
- понятное направление;
- предсказуемая скорость;
- стабильный hitbox.

## Recovery должен быть настоящим состоянием

После атаки враг не должен мгновенно переходить из attack в новую атаку без читаемой паузы.

---

# 11. Movement polish

До добавления WindBox необходимо отполировать движение.

Проверить:

- acceleration;
- deceleration;
- maximum speed;
- direction change;
- diagonal/axis movement;
- collision;
- edge behavior;
- response to input release;
- response to forced movement.

### Цель

Игрок должен точно понимать:

> если я начал движение сейчас, где я окажусь через короткий интервал.

Небольшая инерция допустима.

Непредсказуемая инерция недопустима.

---

# 12. Arena / field requirements

Поле должно быть достаточно большим, чтобы:

- Canodumb создавал линию угрозы;
- Swordy создавал melee pressure;
- Piranha создавал delayed projectile;
- OldStov создавал area denial;
- WindBox создавал forced movement;
- игрок мог одновременно видеть несколько угроз.

Не увеличивать поле ради большего пространства.

Поле должно быть минимального размера, при котором все семь паттернов остаются различимыми.

---

# 13. Тестовые сценарии

## Test A: pure movement

Enemy:

- Mettaur

Chips:

- none / минимальный атакующий чип

Проверить:

- движение;
- остановку;
- смену направления.

---

## Test B: projectile

Enemies:

- Mettaur
- Canodumb

Chips:

- Cannon
- Vulcan

Проверить:

- dodge;
- projectile speed;
- startup;
- Counter.

---

## Test C: melee

Enemies:

- Swordy

Chips:

- Sword
- WideSword

Проверить:

- range;
- hitbox;
- attack timing;
- positioning.

---

## Test D: delayed threat

Enemies:

- Piranha

Chips:

- Cannon
- MiniBomb

Проверить:

- prediction;
- delayed attack;
- commitment.

---

## Test E: defensive state

Enemies:

- Armadill

Chips:

- Sword
- Cannon
- Barrier

Проверить:

- vulnerable/armored states;
- defensive timing;
- наказание за неправильный момент.

---

## Test F: field pressure

Enemies:

- OldStov
- Swordy

Chips:

- AreaGrab
- PanelGrab

Проверить:

- доступное пространство;
- area denial;
- positioning.

---

## Test G: forced movement

Enemies:

- WindBox
- Canodumb

Chips:

- Barrier
- Cannon

Проверить:

- управление под displacement;
- projectile avoidance;
- defensive timing.

---

## Test H: complete vertical slice

Enemies:

- Mettaur
- Canodumb
- Swordy
- Piranha
- Armadill
- OldStov
- WindBox

Chips:

- Cannon
- Vulcan
- WideShot
- Sword
- WideSword
- MiniBomb
- AreaGrab
- PanelGrab
- Barrier
- Recover

Проверить:

- все типы угроз;
- все типы ответных действий;
- отсутствие непонятного damage;
- читаемость всех telegraph;
- стабильность movement;
- ценность timing;
- отсутствие доминирующего чипа.

---

# 14. Что НЕ входит в vertical slice

Не добавлять:

- elemental system;
- elemental weaknesses;
- GrassSeed;
- IceSeed;
- Fire/Aqua/Elec/Wood variants;
- Navi Chips;
- Mega/Giga progression;
- сложный Folder building;
- полноценный random Folder generator;
- Program Advances;
- сложные status effects;
- сложные summons;
- дополнительные enemy families;
- сложные bosses.

---

# 15. Три Folder presets

Folder building пока не тестируется как отдельная система.

Использовать три преднастроенных режима.

## BASIC

Только:

- Cannon
- Vulcan
- WideShot
- Sword
- WideSword
- MiniBomb
- Barrier
- Recover

Цель:

> чистый action gameplay.

## CONTROL

Добавить:

- AreaGrab
- PanelGrab

Цель:

> positioning + field manipulation.

## RANDOM

Формировать случайный набор **из разрешённого пула vertical slice**.

Цель:

> проверить, не ломается ли combat loop при непредсказуемом наборе инструментов.

Random Folder не должен использоваться для балансировки progression.

---

# 16. Implementation requirements

Существующий набор врагов и чипов в прототипе необходимо **рефакторить, а не просто дополнить**.

### Enemy data должна позволять задавать:

```text
movementPattern
attackPattern
telegraphDuration
commitDuration
counterWindow
activeDuration
recoveryDuration
hitbox
damage
knockback
vulnerableStates
invulnerableStates
```

### Chip data должна позволять задавать:

```text
startup
activeDuration
recovery
hitbox
damage
knockback
movementLock
targeting
projectileSpeed
projectileLifetime
fieldEffect
```

### Debug mode

Добавить возможность визуализировать:

- player hurtbox;
- enemy hitbox;
- projectile hitbox;
- telegraph state;
- counter window;
- attack state;
- current frame/state timer.

Это необходимо для полировки.

---

# 17. Definition of Done

Vertical slice считается готовым к gameplay polish, когда:

- все 7 врагов работают;
- все 10 чипов работают;
- BASIC Folder полностью играбелен;
- CONTROL Folder полностью играбелен;
- RANDOM Folder создаётся из разрешённого пула;
- movement стабилен;
- каждый enemy attack имеет telegraph;
- каждый основной attack имеет определённый hit/recovery timing;
- Counter window определён отдельно для каждого подходящего врага;
- damage всегда объясним визуально;
- WindBox не ломает управление;
- OldStov не создаёт непредсказуемые ситуации;
- Armadill имеет визуально читаемое armored state;
- Swordy имеет однозначный melee range;
- Piranha имеет однозначный target lock;
- Canodumb имеет однозначный projectile warning;
- Mettaur является базовым timing benchmark.

Только после этого переходить к расширению набора врагов, чипов и Folder building.

---

# 18. Источники

### Capcom

MMBN Legacy Collection Official Web Manual. Battle Screen / Counters / Full Synchro.

https://game.capcom.com/manual/REXEAC/vol2/en/steam/page/3/2

### MMHP

Mega Man Battle Network 6 Data Base. Virus behavior and chip descriptions.

https://www.mmhp.net/GameHints/MMBN6-Data.html

### GameFAQs

Mega Man Battle Network 6: Cybeast Falzar — Virus FAQ by Megaloshi. Enemy behavior, HP, attacks and Swordy/Armadill patterns.

https://gamefaqs.gamespot.com/gba/929992-mega-man-battle-network-6-cybeast-falzar/faqs/47837

### GameFAQs

Mega Man Battle Network 6: Cybeast Falzar — Guide and Walkthrough by AzulFria. Additional enemy attack behavior and Counterattack descriptions.

https://gamefaqs.gamespot.com/gba/929992-mega-man-battle-network-6-cybeast-falzar/faqs/54575

### MMKB / Fandom

Cannon Battle Chip family.

https://megaman.fandom.com/wiki/Cannon_%28Battle_Chip%29

### Battle Network Wiki

Vulcan Battle Chip family.

https://battlenetwork.fandom.com/wiki/Vulcan

### MMKB / Fandom

Folder / Battle Chip examples including MiniBomb, Sword, WideSword, Recover and AreaGrab.

https://megaman.fandom.com/wiki/Folder

---

# 19. Final design principle

MMBN6 используется здесь не как набор чисел для копирования.

Используется его **структура боевого языка**:

```text
READ
→ MOVE
→ COMMIT
→ ATTACK
→ HIT / COUNTER
→ RECOVER
→ REPOSITION
```

Каждый враг должен проверять отдельную часть этого языка.

Каждый чип должен предоставлять игроку понятный способ ответить на одну или несколько угроз.

Если новый enemy или chip не создаёт новую интересную боевую ситуацию, он не нужен вертикальному срезу.
