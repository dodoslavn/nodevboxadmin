'use strict';

// Guest OS type list read from VBoxManage list ostypes (VirtualBox 7.2.6),
// grouped by family to match the real VirtualBox GUI's OS Type picker
// instead of a free-text field. Regenerate by re-running that command if
// the installed VirtualBox version changes significantly.
const OS_TYPE_GROUPS = [
  {
    family: "Windows",
    items: [
      {
        id: "Windows31",
        label: "Windows 3.1"
      },
      {
        id: "Windows95",
        label: "Windows 95"
      },
      {
        id: "Windows98",
        label: "Windows 98"
      },
      {
        id: "WindowsMe",
        label: "Windows ME"
      },
      {
        id: "WindowsNT3x",
        label: "Windows NT 3.x"
      },
      {
        id: "WindowsNT4",
        label: "Windows NT 4"
      },
      {
        id: "Windows2000",
        label: "Windows 2000"
      },
      {
        id: "WindowsXP",
        label: "Windows XP (32-bit)"
      },
      {
        id: "WindowsXP_64",
        label: "Windows XP (64-bit)"
      },
      {
        id: "Windows2003",
        label: "Windows Server 2003 (32-bit)"
      },
      {
        id: "Windows2003_64",
        label: "Windows Server 2003 (64-bit)"
      },
      {
        id: "WindowsVista",
        label: "Windows Vista (32-bit)"
      },
      {
        id: "WindowsVista_64",
        label: "Windows Vista (64-bit)"
      },
      {
        id: "Windows2008",
        label: "Windows Server 2008 (32-bit)"
      },
      {
        id: "Windows2008_64",
        label: "Windows Server 2008 (64-bit)"
      },
      {
        id: "Windows7",
        label: "Windows 7 (32-bit)"
      },
      {
        id: "Windows7_64",
        label: "Windows 7 (64-bit)"
      },
      {
        id: "Windows8",
        label: "Windows 8 (32-bit)"
      },
      {
        id: "Windows8_64",
        label: "Windows 8 (64-bit)"
      },
      {
        id: "Windows81",
        label: "Windows 8.1 (32-bit)"
      },
      {
        id: "Windows81_64",
        label: "Windows 8.1 (64-bit)"
      },
      {
        id: "Windows2012_64",
        label: "Windows Server 2012 (64-bit)"
      },
      {
        id: "Windows10",
        label: "Windows 10 (32-bit)"
      },
      {
        id: "Windows10_64",
        label: "Windows 10 (64-bit)"
      },
      {
        id: "Windows2016_64",
        label: "Windows Server 2016 (64-bit)"
      },
      {
        id: "Windows2019_64",
        label: "Windows Server 2019 (64-bit)"
      },
      {
        id: "Windows11_64",
        label: "Windows 11 (64-bit)"
      },
      {
        id: "Windows11_arm64",
        label: "Windows 11 on ARM (64-bit)"
      },
      {
        id: "Windows2022_64",
        label: "Windows Server 2022 (64-bit)"
      },
      {
        id: "Windows2025_64",
        label: "Windows Server 2025 (64-bit)"
      },
      {
        id: "WindowsNT",
        label: "Other Windows (32-bit)"
      },
      {
        id: "WindowsNT_64",
        label: "Other Windows (64-bit)"
      }
    ]
  },
  {
    family: "Linux",
    items: [
      {
        id: "Linux22",
        label: "Linux 2.2 (32-bit)"
      },
      {
        id: "Linux24",
        label: "Linux 2.4 (32-bit)"
      },
      {
        id: "Linux24_64",
        label: "Linux 2.4 (64-bit)"
      },
      {
        id: "Linux26",
        label: "Linux 2.6 / 3.x / 4.x / 5.x (32-bit)"
      },
      {
        id: "Linux26_64",
        label: "Linux 2.6 / 3.x / 4.x / 5.x (64-bit)"
      },
      {
        id: "ArchLinux",
        label: "Arch Linux (32-bit)"
      },
      {
        id: "ArchLinux_64",
        label: "Arch Linux (64-bit)"
      },
      {
        id: "ArchLinux_arm64",
        label: "Arch Linux (ARM 64-bit)"
      },
      {
        id: "Debian",
        label: "Debian (32-bit)"
      },
      {
        id: "Debian_64",
        label: "Debian (64-bit)"
      },
      {
        id: "Debian_arm64",
        label: "Debian (ARM 64-bit)"
      },
      {
        id: "Debian31",
        label: "Debian 3.1 Sarge (32-bit)"
      },
      {
        id: "Debian4",
        label: "Debian 4.0 Etch (32-bit)"
      },
      {
        id: "Debian4_64",
        label: "Debian 4.0 Etch (64-bit)"
      },
      {
        id: "Debian5",
        label: "Debian 5.0 Lenny (32-bit)"
      },
      {
        id: "Debian5_64",
        label: "Debian 5.0 Lenny (64-bit)"
      },
      {
        id: "Debian6",
        label: "Debian 6.0 Squeeze (32-bit)"
      },
      {
        id: "Debian6_64",
        label: "Debian 6.0 Squeeze (64-bit)"
      },
      {
        id: "Debian7",
        label: "Debian 7 Wheezy (32-bit)"
      },
      {
        id: "Debian7_64",
        label: "Debian 7 Wheezy (64-bit)"
      },
      {
        id: "Debian8",
        label: "Debian 8 Jessie (32-bit)"
      },
      {
        id: "Debian8_64",
        label: "Debian 8 Jessie (64-bit)"
      },
      {
        id: "Debian9",
        label: "Debian 9 Stretch (32-bit)"
      },
      {
        id: "Debian9_64",
        label: "Debian 9 Stretch (64-bit)"
      },
      {
        id: "Debian9_arm64",
        label: "Debian 9 Stretch (ARM 64-bit)"
      },
      {
        id: "Debian10",
        label: "Debian 10 Buster (32-bit)"
      },
      {
        id: "Debian10_64",
        label: "Debian 10 Buster (64-bit)"
      },
      {
        id: "Debian10_arm64",
        label: "Debian 10 Buster (ARM 64-bit)"
      },
      {
        id: "Debian11",
        label: "Debian 11 Bullseye (32-bit)"
      },
      {
        id: "Debian11_64",
        label: "Debian 11 Bullseye (64-bit)"
      },
      {
        id: "Debian11_arm64",
        label: "Debian 11 Bullseye (ARM 64-bit)"
      },
      {
        id: "Debian12",
        label: "Debian 12 Bookworm (32-bit)"
      },
      {
        id: "Debian12_64",
        label: "Debian 12 Bookworm (64-bit)"
      },
      {
        id: "Debian12_arm64",
        label: "Debian 12 Bookworm (ARM 64-bit)"
      },
      {
        id: "Debian13_64",
        label: "Debian 13 Trixie (64-bit)"
      },
      {
        id: "Debian13_arm64",
        label: "Debian 13 Trixie (ARM 64-bit)"
      },
      {
        id: "Fedora",
        label: "Fedora (32-bit)"
      },
      {
        id: "Fedora_64",
        label: "Fedora (64-bit)"
      },
      {
        id: "Fedora_arm64",
        label: "Fedora (ARM 64-bit)"
      },
      {
        id: "Gentoo",
        label: "Gentoo (32-bit)"
      },
      {
        id: "Gentoo_64",
        label: "Gentoo (64-bit)"
      },
      {
        id: "Mandriva",
        label: "Mandriva (32-bit)"
      },
      {
        id: "Mandriva_64",
        label: "Mandriva (64-bit)"
      },
      {
        id: "OpenMandriva_Lx",
        label: "OpenMandriva Lx (32-bit)"
      },
      {
        id: "OpenMandriva_Lx_64",
        label: "OpenMandriva Lx (64-bit)"
      },
      {
        id: "PCLinuxOS",
        label: "PCLinuxOS / PCLOS (32-bit)"
      },
      {
        id: "PCLinuxOS_64",
        label: "PCLinuxOS / PCLOS (64-bit)"
      },
      {
        id: "Mageia",
        label: "Mageia (32-bit)"
      },
      {
        id: "Mageia_64",
        label: "Mageia (64-bit)"
      },
      {
        id: "Oracle",
        label: "Oracle Linux (32-bit)"
      },
      {
        id: "Oracle_64",
        label: "Oracle Linux (64-bit)"
      },
      {
        id: "Oracle_arm64",
        label: "Oracle Linux (ARM 64-bit)"
      },
      {
        id: "Oracle4",
        label: "Oracle Linux 4.x (32-bit)"
      },
      {
        id: "Oracle4_64",
        label: "Oracle Linux 4.x (64-bit)"
      },
      {
        id: "Oracle5",
        label: "Oracle Linux 5.x (32-bit)"
      },
      {
        id: "Oracle5_64",
        label: "Oracle Linux 5.x (64-bit)"
      },
      {
        id: "Oracle6",
        label: "Oracle Linux 6.x (32-bit)"
      },
      {
        id: "Oracle6_64",
        label: "Oracle Linux 6.x (64-bit)"
      },
      {
        id: "Oracle7_64",
        label: "Oracle Linux 7.x (64-bit)"
      },
      {
        id: "Oracle7_arm64",
        label: "Oracle Linux 7.x (ARM 64-bit)"
      },
      {
        id: "Oracle8_64",
        label: "Oracle Linux 8.x (64-bit)"
      },
      {
        id: "Oracle8_arm64",
        label: "Oracle Linux 8.x (ARM 64-bit)"
      },
      {
        id: "Oracle9_64",
        label: "Oracle Linux 9.x (64-bit)"
      },
      {
        id: "Oracle9_arm64",
        label: "Oracle Linux 9.x (ARM 64-bit)"
      },
      {
        id: "Oracle10_64",
        label: "Oracle Linux 10.x (64-bit)"
      },
      {
        id: "Oracle10_arm64",
        label: "Oracle Linux 10.x (ARM 64-bit)"
      },
      {
        id: "RedHat",
        label: "Red Hat (32-bit)"
      },
      {
        id: "RedHat_64",
        label: "Red Hat (64-bit)"
      },
      {
        id: "RedHat3",
        label: "Red Hat 3.x (32-bit)"
      },
      {
        id: "RedHat3_64",
        label: "Red Hat 3.x (64-bit)"
      },
      {
        id: "RedHat4",
        label: "Red Hat 4.x (32-bit)"
      },
      {
        id: "RedHat4_64",
        label: "Red Hat 4.x (64-bit)"
      },
      {
        id: "RedHat5",
        label: "Red Hat 5.x (32-bit)"
      },
      {
        id: "RedHat5_64",
        label: "Red Hat 5.x (64-bit)"
      },
      {
        id: "RedHat6",
        label: "Red Hat 6.x (32-bit)"
      },
      {
        id: "RedHat6_64",
        label: "Red Hat 6.x (64-bit)"
      },
      {
        id: "RedHat7_64",
        label: "Red Hat 7.x (64-bit)"
      },
      {
        id: "RedHat7_arm64",
        label: "Red Hat 7.x (ARM 64-bit)"
      },
      {
        id: "RedHat8_64",
        label: "Red Hat 8.x (64-bit)"
      },
      {
        id: "RedHat8_arm64",
        label: "Red Hat 8.x (ARM 64-bit)"
      },
      {
        id: "RedHat9_64",
        label: "Red Hat 9.x (64-bit)"
      },
      {
        id: "RedHat9_arm64",
        label: "Red Hat 9.x (ARM 64-bit)"
      },
      {
        id: "RedHat10_64",
        label: "Red Hat 10.x (64-bit)"
      },
      {
        id: "RedHat10_arm64",
        label: "Red Hat 10.x (ARM 64-bit)"
      },
      {
        id: "OpenSUSE",
        label: "openSUSE (32-bit)"
      },
      {
        id: "OpenSUSE_64",
        label: "openSUSE (64-bit)"
      },
      {
        id: "OpenSUSE_Leap_64",
        label: "openSUSE Leap (64-bit)"
      },
      {
        id: "OpenSUSE_Leap_arm64",
        label: "openSUSE Leap (ARM 64-bit)"
      },
      {
        id: "OpenSUSE_Tumbleweed",
        label: "openSUSE Tumbleweed (32-bit)"
      },
      {
        id: "OpenSUSE_Tumbleweed_64",
        label: "openSUSE Tumbleweed (64-bit)"
      },
      {
        id: "OpenSUSE_Tumbleweed_arm64",
        label: "openSUSE Tumbleweed (ARM 64-bit)"
      },
      {
        id: "SUSE_LE",
        label: "SUSE Linux Enterprise (32-bit)"
      },
      {
        id: "SUSE_LE_64",
        label: "SUSE Linux Enterprise (64-bit)"
      },
      {
        id: "Turbolinux",
        label: "Turbolinux (32-bit)"
      },
      {
        id: "Turbolinux_64",
        label: "Turbolinux (64-bit)"
      },
      {
        id: "Ubuntu",
        label: "Ubuntu (32-bit)"
      },
      {
        id: "Ubuntu_64",
        label: "Ubuntu (64-bit)"
      },
      {
        id: "Ubuntu_arm64",
        label: "Ubuntu (ARM 64-bit)"
      },
      {
        id: "Ubuntu10_LTS",
        label: "Ubuntu 10.04 LTS (Lucid Lynx) (32-bit)"
      },
      {
        id: "Ubuntu10_LTS_64",
        label: "Ubuntu 10.04 LTS (Lucid Lynx) (64-bit)"
      },
      {
        id: "Ubuntu10",
        label: "Ubuntu 10.10 (Maverick Meerkat) (32-bit)"
      },
      {
        id: "Ubuntu10_64",
        label: "Ubuntu 10.10 (Maverick Meerkat) (64-bit)"
      },
      {
        id: "Ubuntu11",
        label: "Ubuntu 11.04 (Natty Narwhal) / 11.10 (Oneiric Ocelot) (32-bit)"
      },
      {
        id: "Ubuntu11_64",
        label: "Ubuntu 11.04 (Natty Narwhal) / 11.10 (Oneiric Ocelot) (64-bit)"
      },
      {
        id: "Ubuntu12_LTS",
        label: "Ubuntu 12.04 LTS (Precise Pangolin) (32-bit)"
      },
      {
        id: "Ubuntu12_LTS_64",
        label: "Ubuntu 12.04 LTS (Precise Pangolin) (64-bit)"
      },
      {
        id: "Ubuntu12",
        label: "Ubuntu 12.10 (Quantal Quetzal) (32-bit)"
      },
      {
        id: "Ubuntu12_64",
        label: "Ubuntu 12.10 (Quantal Quetzal) (64-bit)"
      },
      {
        id: "Ubuntu13",
        label: "Ubuntu 13.04 (Raring Ringtail) / 13.10 (Saucy Salamander) (32-bit)"
      },
      {
        id: "Ubuntu13_64",
        label: "Ubuntu 13.04 (Raring Ringtail) / 13.10 (Saucy Salamander) (64-bit)"
      },
      {
        id: "Ubuntu14_LTS",
        label: "Ubuntu 14.04 LTS (Trusty Tahr) (32-bit)"
      },
      {
        id: "Ubuntu14_LTS_64",
        label: "Ubuntu 14.04 LTS (Trusty Tahr) (64-bit)"
      },
      {
        id: "Ubuntu14",
        label: "Ubuntu 14.10 (Utopic Unicorn) (32-bit)"
      },
      {
        id: "Ubuntu14_64",
        label: "Ubuntu 14.10 (Utopic Unicorn) (64-bit)"
      },
      {
        id: "Ubuntu15",
        label: "Ubuntu 15.04 (Vivid Vervet) / 15.10 (Wily Werewolf) (32-bit)"
      },
      {
        id: "Ubuntu15_64",
        label: "Ubuntu 15.04 (Vivid Vervet) / 15.10 (Wily Werewolf) (64-bit)"
      },
      {
        id: "Ubuntu16_LTS",
        label: "Ubuntu 16.04 LTS (Xenial Xerus) (32-bit)"
      },
      {
        id: "Ubuntu16_LTS_64",
        label: "Ubuntu 16.04 LTS (Xenial Xerus) (64-bit)"
      },
      {
        id: "Ubuntu16",
        label: "Ubuntu 16.10 (Yakkety Yak) (32-bit)"
      },
      {
        id: "Ubuntu16_64",
        label: "Ubuntu 16.10 (Yakkety Yak) (64-bit)"
      },
      {
        id: "Ubuntu17",
        label: "Ubuntu 17.04 (Zesty Zapus) / 17.10 (Artful Aardvark) (32-bit)"
      },
      {
        id: "Ubuntu17_64",
        label: "Ubuntu 17.04 (Zesty Zapus) / 17.10 (Artful Aardvark) (64-bit)"
      },
      {
        id: "Ubuntu18_LTS",
        label: "Ubuntu 18.04 LTS (Bionic Beaver) (32-bit)"
      },
      {
        id: "Ubuntu18_LTS_64",
        label: "Ubuntu 18.04 LTS (Bionic Beaver) (64-bit)"
      },
      {
        id: "Ubuntu18",
        label: "Ubuntu 18.10 (Cosmic Cuttlefish) (32-bit)"
      },
      {
        id: "Ubuntu18_64",
        label: "Ubuntu 18.10 (Cosmic Cuttlefish) (64-bit)"
      },
      {
        id: "Ubuntu19",
        label: "Ubuntu 19.04 (Disco Dingo) / 19.10 (Eoan Ermine) (32-bit)"
      },
      {
        id: "Ubuntu19_64",
        label: "Ubuntu 19.04 (Disco Dingo) / 19.10 (Eoan Ermine) (64-bit)"
      },
      {
        id: "Ubuntu20_LTS_64",
        label: "Ubuntu 20.04 LTS (Focal Fossa) (64-bit)"
      },
      {
        id: "Ubuntu20_64",
        label: "Ubuntu 20.10 (Groovy Gorilla) (64-bit)"
      },
      {
        id: "Ubuntu21_64",
        label: "Ubuntu 21.04 (Hirsute Hippo) / 21.10 (Impish Indri) (64-bit)"
      },
      {
        id: "Ubuntu22_LTS_64",
        label: "Ubuntu 22.04 LTS (Jammy Jellyfish) (64-bit)"
      },
      {
        id: "Ubuntu22_64",
        label: "Ubuntu 22.10 (Kinetic Kudu) (64-bit)"
      },
      {
        id: "Ubuntu22_arm64",
        label: "Ubuntu 22.10 (Kinetic Kudu) (ARM 64-bit)"
      },
      {
        id: "Ubuntu23_64",
        label: "Ubuntu 23.04 (Lunar Lobster) (64-bit)"
      },
      {
        id: "Ubuntu23_arm64",
        label: "Ubuntu 23.04 (Lunar Lobster) (ARM 64-bit)"
      },
      {
        id: "Ubuntu231_64",
        label: "Ubuntu 23.10 (Mantic Minotaur) (64-bit)"
      },
      {
        id: "Ubuntu231_arm64",
        label: "Ubuntu 23.10 (Mantic Minotaur) (ARM 64-bit)"
      },
      {
        id: "Ubuntu24_LTS_64",
        label: "Ubuntu 24.04 LTS (Noble Numbat) (64-bit)"
      },
      {
        id: "Ubuntu24_LTS_arm64",
        label: "Ubuntu 24.04 LTS (Noble Numbat) (ARM 64-bit)"
      },
      {
        id: "Ubuntu24_64",
        label: "Ubuntu 24.10 (Oracular Oriole) (64-bit)"
      },
      {
        id: "Ubuntu24_arm64",
        label: "Ubuntu 24.10 (Oracular Oriole) (ARM 64-bit)"
      },
      {
        id: "Ubuntu25_64",
        label: "Ubuntu 25.04 (Plucky Puffin) (64-bit)"
      },
      {
        id: "Ubuntu25_arm64",
        label: "Ubuntu 25.04 (Plucky Puffin) (ARM 64-bit)"
      },
      {
        id: "Lubuntu",
        label: "Lubuntu (32-bit)"
      },
      {
        id: "Lubuntu_64",
        label: "Lubuntu (64-bit)"
      },
      {
        id: "Xubuntu",
        label: "Xubuntu (32-bit)"
      },
      {
        id: "Xubuntu_64",
        label: "Xubuntu (64-bit)"
      },
      {
        id: "Xandros",
        label: "Xandros (32-bit)"
      },
      {
        id: "Xandros_64",
        label: "Xandros (64-bit)"
      },
      {
        id: "Linux",
        label: "Other Linux (32-bit)"
      },
      {
        id: "Linux_64",
        label: "Other Linux (64-bit)"
      },
      {
        id: "Linux_arm64",
        label: "Other Linux (ARM 64-bit)"
      }
    ]
  },
  {
    family: "Solaris",
    items: [
      {
        id: "Solaris",
        label: "Oracle Solaris 10 5/09 and earlier (32-bit)"
      },
      {
        id: "Solaris_64",
        label: "Oracle Solaris 10 5/09 and earlier (64-bit)"
      },
      {
        id: "Solaris10U8_or_later",
        label: "Oracle Solaris 10 10/09 and later (32-bit)"
      },
      {
        id: "Solaris10U8_or_later_64",
        label: "Oracle Solaris 10 10/09 and later (64-bit)"
      },
      {
        id: "Solaris11_64",
        label: "Oracle Solaris 11 (64-bit)"
      },
      {
        id: "OpenSolaris",
        label: "OpenSolaris / Illumos / OpenIndiana (32-bit)"
      },
      {
        id: "OpenSolaris_64",
        label: "OpenSolaris / Illumos / OpenIndiana (64-bit)"
      }
    ]
  },
  {
    family: "BSD",
    items: [
      {
        id: "FreeBSD",
        label: "FreeBSD (32-bit)"
      },
      {
        id: "FreeBSD_64",
        label: "FreeBSD (64-bit)"
      },
      {
        id: "FreeBSD_arm64",
        label: "FreeBSD (ARM 64-bit)"
      },
      {
        id: "OpenBSD",
        label: "OpenBSD (32-bit)"
      },
      {
        id: "OpenBSD_64",
        label: "OpenBSD (64-bit)"
      },
      {
        id: "OpenBSD_arm64",
        label: "OpenBSD (ARM 64-bit)"
      },
      {
        id: "NetBSD",
        label: "NetBSD (32-bit)"
      },
      {
        id: "NetBSD_64",
        label: "NetBSD (64-bit)"
      },
      {
        id: "NetBSD_arm64",
        label: "NetBSD (ARM 64-bit)"
      }
    ]
  },
  {
    family: "OS2",
    items: [
      {
        id: "OS21x",
        label: "OS/2 1.x"
      },
      {
        id: "OS2Warp3",
        label: "OS/2 Warp 3"
      },
      {
        id: "OS2Warp4",
        label: "OS/2 Warp 4"
      },
      {
        id: "OS2Warp45",
        label: "OS/2 Warp 4.5"
      },
      {
        id: "OS2eCS",
        label: "eComStation"
      },
      {
        id: "OS2ArcaOS",
        label: "ArcaOS"
      },
      {
        id: "OS2",
        label: "Other OS/2"
      }
    ]
  },
  {
    family: "MacOS",
    items: [
      {
        id: "MacOS",
        label: "Mac OS X (32-bit)"
      },
      {
        id: "MacOS_64",
        label: "Mac OS X (64-bit)"
      },
      {
        id: "MacOS106",
        label: "Mac OS X 10.6 Snow Leopard (32-bit)"
      },
      {
        id: "MacOS106_64",
        label: "Mac OS X 10.6 Snow Leopard (64-bit)"
      },
      {
        id: "MacOS107_64",
        label: "Mac OS X 10.7 Lion (64-bit)"
      },
      {
        id: "MacOS108_64",
        label: "Mac OS X 10.8 Mountain Lion (64-bit)"
      },
      {
        id: "MacOS109_64",
        label: "Mac OS X 10.9 Mavericks (64-bit)"
      },
      {
        id: "MacOS1010_64",
        label: "Mac OS X 10.10 Yosemite (64-bit)"
      },
      {
        id: "MacOS1011_64",
        label: "Mac OS X 10.11 El Capitan (64-bit)"
      },
      {
        id: "MacOS1012_64",
        label: "macOS 10.12 Sierra (64-bit)"
      },
      {
        id: "MacOS1013_64",
        label: "macOS 10.13 High Sierra (64-bit)"
      }
    ]
  },
  {
    family: "Other",
    items: [
      {
        id: "Other",
        label: "Other/Unknown"
      },
      {
        id: "Other_64",
        label: "Other/Unknown (64-bit)"
      },
      {
        id: "Other_arm64",
        label: "Other/Unknown (ARM 64-bit)"
      },
      {
        id: "DOS",
        label: "DOS"
      },
      {
        id: "Netware",
        label: "Netware"
      },
      {
        id: "L4",
        label: "L4"
      },
      {
        id: "QNX",
        label: "QNX"
      },
      {
        id: "JRockitVE",
        label: "JRockitVE"
      },
      {
        id: "VBoxBS_64",
        label: "VirtualBox Bootsector Test (64-bit)"
      }
    ]
  }
];

const OS_TYPE_IDS = OS_TYPE_GROUPS.flatMap((g) => g.items.map((i) => i.id));

// `showvminfo --machinereadable`'s ostype field reports the description
// ("Debian (64-bit)"), not the ID token the dropdown/modifyvm --ostype use
// ("Debian_64") - confirmed by testing. This reverse-maps the read-back
// value to the right ID so the edit form preselects the VM's actual current
// OS type instead of leaving the dropdown on "(not set)". Labels are unique
// across the whole list (verified when this file was generated), so the map
// is unambiguous.
const OS_TYPE_ID_BY_LABEL = Object.fromEntries(
  OS_TYPE_GROUPS.flatMap((g) => g.items.map((i) => [i.label, i.id]))
);

module.exports = { OS_TYPE_GROUPS, OS_TYPE_IDS, OS_TYPE_ID_BY_LABEL };
