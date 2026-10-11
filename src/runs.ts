// Planned autopilot runs (searched with scratch/beam.test.ts), per map and tick rate, for the standard movement
// settings: one move per 1/16 s, run-length coded (src/plan.ts), replayed exactly from a fresh start.
export const RUNS: Record<string, { run: string; time: number }> = {
  'gauntlet@128': { time: 77.09375, run: "m1075cbd2ec2b5db8d2cdcdb12cdc2md5fcb7dcemfd5fbdeaefbd2bcfd2b2d3bmdbd2amdfcdfbdb2dbec3dcdcdcdcdcdcdcdcdcdcdcbdmc13d4fb2c4b8dcdcdbcdcdcdcdcdcdbcdmc9a" },
  'stages@128': { time: 52.3359375, run: "m715edb2f2bafaf2a2fafada2fd3fa4faf2afa2f2a2fadfdbdb3db3db9f2afafaf2a2fafaf3bdcbdb2cdeb2d2cdc2db5mcd10b2fbfb2dcb6dbcd2b4a" },
  'utopia@128': { time: 32.8828125, run: "m31bafaf2af2a2da2fafd3ma2f2a2f2a2f2a2f2a2fa5f2a2da2faf2a2f2a2fdfdadbdcb5mb15d4afafa3dafdf2afafafafafaf2cmb2cmcdc2db3d2cdcdcdcdcdcdmcb3cd8fafafafad3a2fafafafafafafad5fbfbc2bmbmab2mbebebecb3cb3cb3ced3cmcfc4dcb2ed3bdb5d3fcdbd6cmbc3bdcdcad2f2b2d2b2dcbcdb2d4bd3mcb5m3bmd2m2cb9cb2dfd2cdfbd3cbcbd2bcb2eb4mdb2mb5mdfbd2f2bmdbm2b3eb6d2b2fb5mcbcbcfhd3b3c2b3dcm2d2b2d4b2d7fbfbcdcdb2db3mc2b8mc2dbmd3cdcb3dmdmd3fafaf2eb2dfafafcb6c2a" },
};
