#let personal = yaml("personal.yaml")
#let show-photo = personal.at("show_photo", default: false)
#let photo-path = personal.at("photo_path", default: "photo.jpg")

#set page(
  paper: "a4",
  margin: (x: 15mm, y: 13mm),
)
#set text(font: "Arial", size: 10pt)
#set par(leading: 0.28em)
#set list(indent: 12pt, body-indent: 4pt, spacing: 4pt)

#let section(title) = {
  v(6pt)
  text(size: 10.5pt, weight: "bold")[#title]
  v(1pt)
  line(length: 100%, stroke: 0.5pt)
  v(3pt)
}

#let role(title, period, company, place, body) = {
  block(breakable: false)[
    #grid(
      columns: (1fr, auto),
      gutter: 8pt,
      [#text(weight: "bold")[#title]],
      [#text(weight: "bold")[#period]],
    )
    #if place == "" {
      text(weight: "bold")[#company]
    } else {
      text(weight: "bold")[#company | #place]
    }
    #v(2pt)
    #body
    #v(3pt)
  ]
}

#let project(title, url, description, tech) = {
  block(breakable: false)[
    *#title* - #link(url)[#url] \
    #description *Tech:* #tech
    v(3pt)
  ]
}

#let contacts = [
  #personal.location | #personal.phone | #link("mailto:" + personal.email)[#personal.email]
  #linebreak()
  #link("https://linkedin.com/in/vitaliihanych")[linkedin.com/in/vitaliihanych] | #link("https://github.com/badwolf-vitalii")[github.com/badwolf-vitalii]
]

#block(breakable: false)[
  #if show-photo {
    grid(
      columns: (1fr, 28mm),
      column-gutter: 14pt,
      align(center)[
        #text(size: 20pt, weight: "bold")[Vitalii Hanych]
        #v(2pt)
        #text(size: 11pt, weight: "bold")[.NET Software Engineer | C\# | WPF | ASP.NET Core | REST APIs | SQL]
        #v(3pt)
        #contacts
      ],
      align(right + horizon)[
        #box(
          width: 29mm,
          height: 29mm,
          radius: 50%,
          clip: true,
          inset: 0pt,
          stroke: 0.6pt + luma(170),
        )[
          #image(photo-path, width: 100%, height: 100%, fit: "cover")
        ]
      ],
    )
  } else {
    align(center)[
      #text(size: 20pt, weight: "bold")[Vitalii Hanych]
      #v(2pt)
      #text(size: 11pt, weight: "bold")[.NET Software Engineer | C\# | WPF | ASP.NET Core | REST APIs | SQL]
      #v(3pt)
      #contacts
    ]
  }
]

#block(breakable: false)[
  #section("PROFESSIONAL SUMMARY")
  Senior .NET software engineer with 10+ years of experience building and maintaining desktop, web, and integration-heavy applications. Strong in C\#, WPF, ASP.NET Core, REST APIs, SQL, system integration, and production troubleshooting, with a focus on reliable, maintainable solutions.
]

#block(breakable: false)[
  #section("TECHNICAL SKILLS")
  *Core:* C\# | .NET 8 / 6 | .NET Framework 4.8 | WPF | XAML \
  *Backend & Web:* ASP.NET Core | REST APIs | ASP.NET MVC | SignalR | WCF | Windows Services | IIS \
  *Data:* SQL Server | SQLite | Oracle | EF Core | Dapper | LINQ | T-SQL \
  *Integration & Engineering:* System Integration | Hardware & Peripheral Integration | Debugging & Diagnostics | Production Troubleshooting | Legacy System Modernization | Git | Jira | Unit Testing \
  *Additional:* JavaScript | Xamarin | C/C++ | Objective-C
]

#block(breakable: false)[
  #section("PROFESSIONAL EXPERIENCE")
  #role(
    "Senior Software Developer",
    "Jan 2021 - Present",
    "A.E.P. Ticketing Solutions S.R.L.",
    "Italy",
    [
      - Develop and maintain C\#/.NET software for public-transport ticketing and fare-collection systems across desktop and backend components.
      - Build WPF applications and integrate software with POS terminals, printers, coin devices, card readers, and other external hardware/services.
      - Investigate production incidents across applications, services, devices, and communication layers; improve reliability, logging, error handling, and diagnostics.
      - Work with SQL Server and Oracle, Git, Jira, unit testing, IIS/Windows Services, deployments, maintenance, and legacy-system modernization.
    ]
  )
]

#role(
  "Software Engineer / Software Engineer (Ext.)",
  "Jan 2018 - Jan 2021",
  "Conduent Business Solutions Italia S.P.A.",
  "Vimodrone (MI), Italy",
  [
    - Developed C\#/.NET/WPF software for manned and unmanned ticketing vending machines and integrated POS, printers, banknote recyclers, coin dispensers, QR readers, and other peripherals.
    - Worked with WCF, ASP.NET MVC, Windows Services, IIS, SQL Server, Git/TFS, unit testing, and Agile development.
  ]
)

#role(
  "Software Engineer",
  "Jul 2017 - Jul 2019",
  "Ulisse s.r.l.",
  "Milan, Italy",
  [
    - Developed Xamarin cross-platform applications for Android/iOS and integrated ASP.NET Web API, Windows Services, and SQL Server.
    - Worked with unit testing and TFS for task and source-code management.
  ]
)

#role(
  "Junior Software Developer",
  "Mar 2011 - Jul 2013",
  "ADVA SOFT",
  "Lviv, Ukraine",
  [
    - Developed iOS software in C/C++/Objective-C, image-processing algorithms and shaders, plus C\#/JavaScript components and 3D games with Unity3D.
  ]
)

#block(breakable: false)[
  #section("SELECTED PROJECTS")
  #project(
    "Bad Wolf Quiz",
    "https://github.com/badwolf-vitalii/BadWolfQuiz",
    "Real-time multimedia quiz platform with host-controlled games, player lobbies, buzzer flows, media-rich questions, and persistent game state.",
    "ASP.NET Core | SignalR | EF Core | SQLite",
  )
]

#project(
  "NoteKeeper",
  "https://github.com/badwolf-vitalii/NoteKeeper",
  "Personal knowledge and time-management app with rich block-based notes, projects, tags, advanced filtering/search, localization, and time tracking.",
  "ASP.NET Core 8 | EF Core | SQLite | JavaScript",
)

#project(
  "CrybbBot",
  "https://github.com/badwolf-vitalii/CrybbBot",
  "WPF desktop app for composing, scheduling, managing, and sending structured Slack messages across multiple channels.",
  ".NET 6 | WPF | Slack API | Dapper | SQLite",
)

#block(breakable: false)[
  #section("EDUCATION & LANGUAGES")
  *Bachelor's Degree in Software Engineering* - Lviv Polytechnic National University, Ukraine (2008-2012) \
  *NVQ Level 3, Programming for Computers and Automated Systems* - Chervonograd State College, Ukraine (2004-2008)

  #v(3pt)
  *Languages:* Ukrainian - Native | Italian - C1 | English - B2 | Russian - C2
]
