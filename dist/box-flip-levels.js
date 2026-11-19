"use strict";

// Layout reference: https://github.com/Asymetry1021/Parabox/blob/main/levels.json
BoxCampaign.flip = [
  {
    title: "翻转 1",
    hint: "镜像箱子的左右出入口相反；这一关可以转成传送门地图。",
    rows: ["#########","#       #","#     @ #","#       #","   r###  ","### #.###","##     ##","#####  ##","#########"],
    rooms: {},
    clones: {},
    finish: [4,1],
    finishRoom: "root",
    colors: {"root":"#786efa"},
    flipped: ["root"],
  },
  {
    title: "翻转 2",
    hint: "镜像箱子的左右出入口相反；这一关可以转成传送门地图。",
    rows: ["#########","#   #  ##","# # @   #","# # # r##","  # ##   ","### .####","##   ####","###  ####","#########"],
    rooms: {},
    clones: {},
    finish: [4,7],
    finishRoom: "root",
    colors: {"root":"#786efa"},
    flipped: ["root"],
  },
];
