// Prüft den Schlüssel des IP-Backstops am Toni-Chat (ipBackstopKey in ai-chat-core.ts): IPv4 bleibt
// die volle Adresse, IPv6 zählt je /64-Netz, Unlesbares bleibt unverändert. Ohne Server, ohne DB.
// Aufruf: npm run ip-backstop:check
import { ipBackstopKey } from "@/lib/ai-chat-core";

let failed = 0;
function same(input: string, expected: string) {
  const got = ipBackstopKey(input);
  if (got === expected) console.log(`  ok    ${input} -> ${got}`);
  else {
    failed++;
    console.log(`  FEHLT ${input} -> ${got} (erwartet ${expected})`);
  }
}

console.log("\nIPv4 unverändert (Hash bleibt wie vor der Änderung)");
same("203.0.113.7", "203.0.113.7");
same(" 203.0.113.7 ", "203.0.113.7");
same("::ffff:203.0.113.7", "203.0.113.7");

console.log("\nIPv6: ein /64 = ein Schlüssel");
same("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64");
same("2001:db8:1:2::1", "2001:db8:1:2::/64");
same("2001:DB8:0001:0002:ffff::", "2001:db8:1:2::/64");
same("[2001:db8:1:2::9]", "2001:db8:1:2::/64");
same("fe80::1%en0", "fe80:0:0:0::/64");
same("2001:db8::", "2001:db8:0:0::/64");
same("2001:db8:1:2:3:4:1.2.3.4", "2001:db8:1:2::/64");
same("2001:db8:1:3::1", "2001:db8:1:3::/64");

console.log("\nUnlesbar: volle Zeichenkette, nie ein geteiltes Netz");
same("2001:db8::1::2", "2001:db8::1::2");
same("1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8:9");
same("1:2:3", "1:2:3");
same("203.0.113.7:443", "203.0.113.7:443");
same("zzzz:db8:1:2::1", "zzzz:db8:1:2::1");
same("::1", "::1");
same("::", "::");
same("0:0:0:0:0:ffff:203.0.113.7", "0:0:0:0:0:ffff:203.0.113.7");
same("::ffff:cb00:7107", "::ffff:cb00:7107");
same("::ffff:0:1.2.3.4", "::ffff:0:1.2.3.4");
same("::1.2.3.4", "::1.2.3.4");
same("2001:db8:1:2::zz", "2001:db8:1:2::zz");
same("1:2:3:4:5:6:7:", "1:2:3:4:5:6:7:");
same("1:2:3:4::1.2.3.4:6", "1:2:3:4::1.2.3.4:6");
same(":::", ":::");

console.log(failed ? `\n${failed} FEHLT` : "\nAlles ok");
process.exit(failed ? 1 : 0);
