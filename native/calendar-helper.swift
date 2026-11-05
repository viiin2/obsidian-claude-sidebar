// Claude 비서 캘린더 도우미 (macOS 전용).
// 맥은 캘린더 접근 권한을 "앱"에 주기 때문에, 옵시디언이 꺼져 있을 때도(예약 실행) 캘린더를 읽고 쓸 수 있게
// 이 작은 앱이 대신 EventKit으로 애플 캘린더를 다룹니다. 처음 한 번 "캘린더 접근 허용" 창이 뜹니다.
//
// 실행: open -g -W -n ClaudeCalendar.app --args <명령> <결과.json> [인자...]
//   auth                                   권한 확인·요청 → {"ok":true,"status":"full"}
//   calendars                              캘린더 목록 → {"ok":true,"calendars":[{id,title,writable,default}]}
//   list <from YYYY-MM-DD> <to YYYY-MM-DD>  일정 (반복 일정 펼침, to 날짜 포함) → {"ok":true,"events":[...]}
//   add <title> <start> <end> <calId|-> <alarmMin|->   start/end: "YYYY-MM-DDTHH:MM" 또는 하루 종일 "YYYY-MM-DD"
//   remove <eventId>
// 빌드: scripts/build-helper.sh

import EventKit
import Foundation

let args = CommandLine.arguments
let outPath = args.count > 2 ? args[2] : "/dev/stdout"
let store = EKEventStore()

func write(_ obj: [String: Any]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{\"ok\":false}".utf8)
  FileManager.default.createFile(atPath: outPath, contents: data)
  exit(0)
}

func fail(_ msg: String) -> Never {
  write(["ok": false, "error": msg])
}

func statusName(_ s: EKAuthorizationStatus) -> String {
  switch s.rawValue {
  case 0: return "notDetermined"
  case 1: return "restricted"
  case 2: return "denied"
  case 3: return "full"
  case 4: return "writeOnly"
  default: return "unknown"
  }
}

func ensureAccess() {
  let s = EKEventStore.authorizationStatus(for: .event)
  if s.rawValue == 3 { return }
  if s.rawValue != 0 { fail("캘린더 접근이 막혀 있어요 (\(statusName(s))). 시스템 설정 → 개인정보 보호 및 보안 → 캘린더에서 Claude 비서 캘린더를 켜 주세요") }
  let sem = DispatchSemaphore(value: 0)
  var granted = false
  store.requestAccess(to: .event) { g, _ in
    granted = g
    sem.signal()
  }
  sem.wait()
  if !granted { fail("캘린더 접근을 허용하지 않았어요") }
}

let local: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = TimeZone.current
  return f
}()

func parseDate(_ s: String) -> (Date, Bool)? {
  local.dateFormat = s.count > 10 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"
  guard let d = local.date(from: s) else { return nil }
  return (d, s.count <= 10)
}

func fmt(_ d: Date, _ allDay: Bool) -> String {
  local.dateFormat = allDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm"
  return local.string(from: d)
}

let op = args.count > 1 ? args[1] : "auth"

switch op {
case "auth":
  ensureAccess()
  write(["ok": true, "status": statusName(EKEventStore.authorizationStatus(for: .event))])

case "calendars":
  ensureAccess()
  let def = store.defaultCalendarForNewEvents?.calendarIdentifier
  let cals = store.calendars(for: .event).map { c -> [String: Any] in
    ["id": c.calendarIdentifier, "title": c.title, "writable": c.allowsContentModifications, "default": c.calendarIdentifier == def, "source": c.source.title]
  }
  write(["ok": true, "calendars": cals])

case "list":
  ensureAccess()
  guard args.count > 4, let (from, _) = parseDate(args[3]), let (toDay, _) = parseDate(args[4]) else { fail("날짜 형식") }
  let to = Calendar.current.date(byAdding: .day, value: 1, to: toDay)!
  let pred = store.predicateForEvents(withStart: from, end: to, calendars: nil)
  let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }.map { e -> [String: Any] in
    var o: [String: Any] = [
      "id": e.eventIdentifier ?? "",
      "title": e.title ?? "",
      "start": fmt(e.startDate, e.isAllDay),
      "end": fmt(e.isAllDay ? e.endDate.addingTimeInterval(-1) : e.endDate, e.isAllDay),
      "allDay": e.isAllDay,
      "calendar": e.calendar.title,
    ]
    if let loc = e.location, !loc.isEmpty { o["location"] = loc }
    return o
  }
  write(["ok": true, "events": events])

case "add":
  ensureAccess()
  guard args.count > 7, let (start, allDay) = parseDate(args[4]), let (end, _) = parseDate(args[5]) else { fail("인자") }
  let e = EKEvent(eventStore: store)
  e.title = args[3]
  e.isAllDay = allDay
  e.startDate = start
  e.endDate = allDay ? start : end
  let calId = args[6]
  if calId != "-", let c = store.calendar(withIdentifier: calId) { e.calendar = c } else { e.calendar = store.defaultCalendarForNewEvents }
  if e.calendar == nil { fail("일정을 넣을 캘린더가 없어요") }
  if let m = Int(args[7]), m >= 0, !allDay { e.addAlarm(EKAlarm(relativeOffset: TimeInterval(-m * 60))) }
  e.notes = "Claude 비서가 넣었어요"
  do {
    try store.save(e, span: .thisEvent, commit: true)
    write(["ok": true, "id": e.eventIdentifier ?? "", "calendar": e.calendar.title])
  } catch {
    fail("일정을 넣지 못했어요: \(error.localizedDescription)")
  }

case "remove":
  ensureAccess()
  guard args.count > 3 else { fail("인자") }
  guard let e = store.event(withIdentifier: args[3]) else { write(["ok": true, "missing": true]) }
  do {
    try store.remove(e, span: .thisEvent, commit: true)
    write(["ok": true])
  } catch {
    fail("일정을 지우지 못했어요: \(error.localizedDescription)")
  }

default:
  fail("모르는 명령: \(op)")
}
